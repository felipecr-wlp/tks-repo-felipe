/**
 * GET  /api/workspaces/[workspaceId]/invites, lista invites activos (admin)
 * POST /api/workspaces/[workspaceId]/invites, crea un invite (admin)
 *
 * Body POST:
 *   {
 *     password?: string,        // opcional
 *     role?: 'admin'|'manager'|'member'|'viewer',  // default 'member'; 'admin' solo lo puede emitir un owner
 *     max_uses?: number,        // null = ilimitado
 *     expires_in_days?: number  // null = no expira
 *   }
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'
import { applyRateLimit } from '@/lib/rate-limit'
import { hashPassword } from '@/lib/password'
import { generateInviteCode } from '@/lib/invite-code'
import { logActivity, ActivityVerbs } from '@/lib/activity'
import { sendEmail, renderInviteEmail, isEmailConfigured } from '@/lib/email'

interface RouteParams {
  params: { workspaceId: string }
}

const createSchema = z.object({
  password:        z.string().min(4).max(100).optional().nullable(),
  role:            z.enum(['admin', 'manager', 'member', 'viewer']).default('member'),
  max_uses:        z.number().int().min(1).max(10_000).optional().nullable(),
  expires_in_days: z.number().int().min(1).max(365).optional().nullable(),
  // Opcional: si se da un correo, se envia la invitacion por email (gateado por
  // config; si el email no esta configurado, simplemente no se manda nada).
  email:           z.string().email().max(200).optional().nullable(),
})

// ── Helper: verifica admin del workspace o de la org ─────────────────────────
async function isAdmin(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  // Admin de la org
  type ProfileRow = { org_role: string | null }
  const { data: profile } = await supabase
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .single() as { data: ProfileRow | null; error: unknown }

  if (profile?.org_role === 'owner' || profile?.org_role === 'admin') {
    return true
  }

  // Admin del workspace
  type MembershipRow = { role: string }
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', userId)
    .single() as { data: MembershipRow | null; error: unknown }

  return membership?.role === 'admin'
}

// ── Helper: verifica owner del workspace o de la org ─────────────────────────
// Barrera para acciones reservadas a owners, como emitir invites con rol admin.
async function isOwner(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  type ProfileRow = { org_role: string | null }
  const { data: profile } = await supabase
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .single() as { data: ProfileRow | null; error: unknown }

  if (profile?.org_role === 'owner') return true

  type MembershipRow = { role: string }
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', userId)
    .single() as { data: MembershipRow | null; error: unknown }

  return membership?.role === 'owner'
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.workspaceId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  if (!(await isAdmin(supabase, user.id, params.workspaceId))) {
    return NextResponse.json({ error: 'Solo admins pueden ver invites' }, { status: 403 })
  }

  type InviteRow = {
    id: string
    code: string
    role: string
    max_uses: number | null
    uses_count: number
    expires_at: string | null
    revoked_at: string | null
    created_at: string
    has_password: boolean
  }

  const { data: invites, error } = await supabase
    .from('workspace_invites')
    .select('id, code, role, max_uses, uses_count, expires_at, revoked_at, created_at, password_hash')
    .eq('workspace_id', params.workspaceId)
    .order('created_at', { ascending: false })
    .limit(50) as {
      data: Array<InviteRow & { password_hash: string | null }> | null
      error: unknown
    }

  if (error) {
    console.error('[invites GET] error:', error)
    return NextResponse.json({ error: 'Error al listar invites' }, { status: 500 })
  }

  // No exponer hash
  const mapped: InviteRow[] = (invites ?? []).map(({ password_hash, ...rest }) => ({
    ...rest,
    has_password: password_hash != null,
  }))

  return NextResponse.json({ invites: mapped })
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.workspaceId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'auth')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  if (!(await isAdmin(supabase, user.id, params.workspaceId))) {
    return NextResponse.json({ error: 'Solo admins pueden crear invites' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos inválidos', details: parsed.error.flatten() },
      { status: 422 }
    )
  }

  const { password, role, max_uses, expires_in_days, email } = parsed.data

  // Un invite con rol admin otorga admin al redimirse: solo un owner puede
  // emitirlo. Sin esta barrera un admin de workspace podia crear invites admin
  // y multiplicar admins (escalada de privilegios).
  if (role === 'admin' && !(await isOwner(supabase, user.id, params.workspaceId))) {
    return NextResponse.json({ error: 'Solo un owner puede crear invites con rol admin' }, { status: 403 })
  }

  const code = generateInviteCode(16)
  const expires_at = expires_in_days
    ? new Date(Date.now() + expires_in_days * 86_400_000).toISOString()
    : null

  type InviteInsert = {
    id: string
    code: string
    role: string
    max_uses: number | null
    uses_count: number
    expires_at: string | null
    created_at: string
  }

  // El cliente RLS de @supabase/ssr tipa el parametro de .insert() como `never`
  // para esta tabla, asi que se castea SOLO el payload (no el cliente) a su tipo
  // Insert real. Ver types.ts (Insert de workspace_invites).
  const invitePayload = {
    workspace_id:  params.workspaceId,
    code,
    password_hash: password ? hashPassword(password) : null,
    role,
    max_uses:      max_uses ?? null,
    expires_at,
    created_by:    user.id,
  } as Database['public']['Tables']['workspace_invites']['Insert']
  const { data: invite, error } = await supabase
    .from('workspace_invites')
    .insert(invitePayload as never)
    .select('id, code, role, max_uses, uses_count, expires_at, created_at')
    .single() as { data: InviteInsert | null; error: unknown }

  if (error || !invite) {
    console.error('[invites POST] insert error:', error)
    // Re-intentar una vez con código nuevo si fue colisión
    const admin = createAdminClient()
    const { data: retry } = await admin
      .from('workspace_invites')
      .insert({
        workspace_id:  params.workspaceId,
        code:          generateInviteCode(20),
        password_hash: password ? hashPassword(password) : null,
        role,
        max_uses:      max_uses ?? null,
        expires_at,
        created_by:    user.id,
      })
      .select('id, code, role, max_uses, uses_count, expires_at, created_at')
      .single() as { data: InviteInsert | null; error: unknown }

    if (!retry) {
      return NextResponse.json({ error: 'Error al crear invite' }, { status: 500 })
    }

    return await respondWithInvite(retry, user.id, params.workspaceId, password != null, email ?? null)
  }

  return await respondWithInvite(invite, user.id, params.workspaceId, password != null, email ?? null)
}

async function respondWithInvite(
  invite: {
    id: string; code: string; role: string; max_uses: number | null
    uses_count: number; expires_at: string | null; created_at: string
  },
  userId: string,
  workspaceId: string,
  hasPassword: boolean,
  email: string | null
): Promise<NextResponse> {
  await logActivity({
    verb: ActivityVerbs.WORKSPACE_INVITE_CREATED,
    subject_id: userId,
    object_type: 'workspace_invite',
    object_id: invite.id,
    workspace_id: workspaceId,
  })

  // Envio opcional de la invitacion por correo (best effort, gateado por config).
  if (email && isEmailConfigured()) {
    try {
      const admin = createAdminClient()
      const db = admin
      const [{ data: ws }, { data: inviter }] = await Promise.all([
        db.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
        db.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
      ])
      const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''
      const { subject, html } = renderInviteEmail({
        inviterName: (inviter?.display_name as string | null) ?? 'Un administrador',
        workspaceName: (ws?.name as string | null) ?? 'un espacio de trabajo',
        joinUrl: `${base}/join/${invite.code}`,
        hasPassword,
      })
      await sendEmail({ to: email, subject, html })
    } catch (err) {
      console.error('[invites POST] email error:', err)
    }
  }

  return NextResponse.json(
    { ...invite, has_password: hasPassword },
    { status: 201 }
  )
}

/**
 * POST /api/invites/[code]/join, usa un invite para unirse al workspace.
 *
 * Body: { password?: string }
 *
 * Reglas:
 *   - Usuario debe estar autenticado
 *   - Si el invite tiene password_hash, debe coincidir
 *   - Si el usuario no tiene org_id → se le asigna el del workspace + org_role 'member'
 *   - Si el usuario tiene org_id distinto → 409 (no se permite cross-org)
 *   - Si ya es miembro del workspace → 200 idempotente
 *   - Increment uses_count atómicamente
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { verifyPassword } from '@/lib/password'
import { logActivity, ActivityVerbs } from '@/lib/activity'

interface RouteParams {
  params: { code: string }
}

const schema = z.object({
  password: z.string().min(1).max(100).optional(),
})

export async function POST(request: NextRequest, { params }: RouteParams) {
  const limited = await applyRateLimit(request, 'auth')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown = {}
  try { body = await request.json() } catch { /* body opcional */ }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })
  }

  const admin = createAdminClient()

  // ── Cargar invite + workspace ──────────────────────────────────────────────
  type InviteRow = {
    id: string
    workspace_id: string
    role: string
    password_hash: string | null
    max_uses: number | null
    uses_count: number
    expires_at: string | null
    revoked_at: string | null
    workspaces: { id: string; slug: string; org_id: string } | null
  }

  const { data: invite } = await admin
    .from('workspace_invites')
    .select(`
      id, workspace_id, role, password_hash, max_uses, uses_count,
      expires_at, revoked_at,
      workspaces ( id, slug, org_id )
    `)
    .eq('code', params.code)
    .single() as { data: InviteRow | null; error: unknown }

  if (!invite || !invite.workspaces) {
    return NextResponse.json({ error: 'Invite no encontrado' }, { status: 404 })
  }
  if (invite.revoked_at) {
    return NextResponse.json({ error: 'Invite revocado' }, { status: 410 })
  }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Invite expirado' }, { status: 410 })
  }
  if (invite.max_uses != null && invite.uses_count >= invite.max_uses) {
    return NextResponse.json({ error: 'Invite agotado' }, { status: 410 })
  }

  // ── Validar password si aplica ─────────────────────────────────────────────
  if (invite.password_hash) {
    if (!parsed.data.password) {
      return NextResponse.json({ error: 'Contraseña requerida', requires_password: true }, { status: 401 })
    }
    if (!verifyPassword(parsed.data.password, invite.password_hash)) {
      return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 })
    }
  }

  // ── Validar org compatibility ──────────────────────────────────────────────
  type ProfileRow = { org_id: string | null; org_role: string | null }
  const { data: profile } = await admin
    .from('profiles')
    .select('org_id, org_role')
    .eq('id', user.id)
    .single() as { data: ProfileRow | null; error: unknown }

  const wsOrgId = invite.workspaces.org_id

  if (profile?.org_id && profile.org_id !== wsOrgId) {
    return NextResponse.json(
      { error: 'Ya perteneces a otra organización' },
      { status: 409 }
    )
  }

  // Asignar org_id si el usuario no tiene
  if (!profile?.org_id) {
    const { error: profileError } = await admin
      .from('profiles')
      .update({ org_id: wsOrgId, org_role: profile?.org_role ?? 'member' })
      .eq('id', user.id)

    if (profileError) {
      console.error('[join] profile update error:', profileError)
      return NextResponse.json({ error: 'Error al actualizar perfil' }, { status: 500 })
    }

    // Agregar a org_members
    await admin
      .from('org_members')
      .insert({ org_id: wsOrgId, profile_id: user.id, role: 'member' })
      .select('id')
      .then(() => null, () => null)  // ignorar duplicados
  }

  // ── ¿Ya es miembro? ────────────────────────────────────────────────────────
  type MemberRow = { workspace_id: string }
  const { data: existing } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('workspace_id', invite.workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: MemberRow | null; error: unknown }

  if (existing) {
    return NextResponse.json({ workspace_slug: invite.workspaces.slug, already_member: true })
  }

  // ── Reservar un cupo del invite de forma atómica ───────────────────────────
  // La comprobación temprana de max_uses (arriba) es solo UX; aquí se decrementa
  // el cupo con un UPDATE guardado en la DB (SECURITY DEFINER) que garantiza que
  // dos redenciones concurrentes no rebasen max_uses. Devuelve el nuevo conteo o
  // null/sin filas si ya está agotado.
  const { data: redeemed, error: redeemError } = await admin
    .rpc('redeem_invite_slot', { p_invite_id: invite.id })

  if (redeemError) {
    console.error('[join] redeem_invite_slot error:', redeemError)
    return NextResponse.json({ error: 'Error al unirse al workspace' }, { status: 500 })
  }
  if (redeemed == null) {
    return NextResponse.json({ error: 'Este invite ya alcanzó su límite de usos' }, { status: 410 })
  }

  // ── Insertar membership ────────────────────────────────────────────────────
  const { error: memberError } = await admin
    .from('workspace_members')
    .insert({
      workspace_id: invite.workspace_id,
      profile_id: user.id,
      role: invite.role,
    })

  if (memberError) {
    console.error('[join] workspace_members insert error:', memberError)
    // Devolver el cupo reservado para no "quemar" un uso por un fallo de insert.
    await admin.rpc('release_invite_slot', { p_invite_id: invite.id })
    return NextResponse.json({ error: 'Error al unirse al workspace' }, { status: 500 })
  }

  // ── Activity log ──────────────────────────────────────────────────────────
  await logActivity({
    verb: ActivityVerbs.WORKSPACE_MEMBER_JOINED,
    subject_id: user.id,
    object_type: 'workspace',
    object_id: invite.workspace_id,
    workspace_id: invite.workspace_id,
    metadata: { invite_id: invite.id, role: invite.role },
  })

  return NextResponse.json({
    workspace_slug: invite.workspaces.slug,
    already_member: false,
  })
}

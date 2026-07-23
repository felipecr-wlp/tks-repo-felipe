/**
 * GET  /api/teams/[teamId]/members  -> lista los miembros del equipo con su perfil y rol
 * POST /api/teams/[teamId]/members  -> agrega un miembro (debe ser ya miembro del workspace)
 *
 * Solo admins del workspace. Roles de equipo: admin | member.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

const postSchema = z
  .object({
    profile_id: z.string().uuid(),
    role: z.enum(['admin', 'member']).optional(),
  })
  .strict()

async function teamWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  teamId: string
): Promise<string | null> {
  const { data } = (await admin
    .from('teams')
    .select('workspace_id')
    .eq('id', teamId)
    .maybeSingle()) as { data: { workspace_id: string } | null; error: unknown }
  return data?.workspace_id ?? null
}

export async function GET(
  request: NextRequest,
  { params }: { params: { teamId: string } }
) {
  if (!isUuid(params.teamId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const admin = createAdminClient()
  const workspaceId = await teamWorkspace(admin, params.teamId)
  if (!workspaceId) return NextResponse.json({ error: 'Equipo no encontrado' }, { status: 404 })

  const auth = await isWorkspaceAdminById(workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  type MemberRow = {
    profile_id: string
    role: string
    created_at: string
    profiles: { id: string; display_name: string | null; email: string | null; avatar_url: string | null } | null
  }

  const { data } = (await admin
    .from('team_members')
    .select('profile_id, role, created_at, profiles ( id, display_name, email, avatar_url )')
    .eq('team_id', params.teamId)
    .order('created_at', { ascending: true })) as { data: MemberRow[] | null; error: unknown }

  const members = (data ?? []).map((m) => ({
    profile_id: m.profile_id,
    role: m.role,
    created_at: m.created_at,
    display_name: m.profiles?.display_name ?? 'Usuario',
    email: m.profiles?.email ?? '',
    avatar_url: m.profiles?.avatar_url ?? null,
  }))

  return NextResponse.json({ members })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { teamId: string } }
) {
  if (!isUuid(params.teamId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const admin = createAdminClient()
  const workspaceId = await teamWorkspace(admin, params.teamId)
  if (!workspaceId) return NextResponse.json({ error: 'Equipo no encontrado' }, { status: 404 })

  const auth = await isWorkspaceAdminById(workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const parsed = postSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })

  // El objetivo debe ser ya miembro del workspace
  const { data: wsMember } = (await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', parsed.data.profile_id)
    .maybeSingle()) as { data: { profile_id: string } | null; error: unknown }
  if (!wsMember)
    return NextResponse.json({ error: 'La persona no es miembro del workspace' }, { status: 409 })

  // Ya en el equipo?
  const { data: existing } = (await admin
    .from('team_members')
    .select('profile_id')
    .eq('team_id', params.teamId)
    .eq('profile_id', parsed.data.profile_id)
    .maybeSingle()) as { data: { profile_id: string } | null; error: unknown }
  if (existing) return NextResponse.json({ error: 'Ya es miembro del equipo' }, { status: 409 })

  const { error } = await admin
    .from('team_members')
    .insert({ team_id: params.teamId, profile_id: parsed.data.profile_id, role: parsed.data.role ?? 'member' })

  if (error) return NextResponse.json({ error: 'Error al agregar el miembro' }, { status: 500 })
  return NextResponse.json({ ok: true }, { status: 201 })
}

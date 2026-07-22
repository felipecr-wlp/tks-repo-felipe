/**
 * Sala de espera (LOBBY) del workspace, endpoints de admin.
 *
 * GET  /api/workspaces/[workspaceId]/lobby
 *   Lista los perfiles de la MISMA organizacion que aun no tienen acceso a
 *   NINGUN workspace (estan esperando ubicacion).
 *
 * POST /api/workspaces/[workspaceId]/lobby
 *   Ubica a un perfil de la sala de espera en ESTE workspace, con rol, y de
 *   forma opcional en un departamento y/o equipo del mismo workspace.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

const WS_ROLES = ['owner', 'admin', 'manager', 'member', 'viewer'] as const

const assignSchema = z.object({
  profile_id: z.string().uuid(),
  role: z.enum(WS_ROLES).default('member'),
  space_id: z.string().uuid().nullable().optional(),
  team_id: z.string().uuid().nullable().optional(),
})

async function orgIdOfWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string
): Promise<string | null> {
  const { data } = (await admin
    .from('workspaces')
    .select('org_id')
    .eq('id', workspaceId)
    .maybeSingle()) as { data: { org_id: string } | null; error: unknown }
  return data?.org_id ?? null
}

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  if (!isUuid(params.workspaceId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const auth = await isWorkspaceAdminById(params.workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  const admin = createAdminClient()
  const orgId = await orgIdOfWorkspace(admin, params.workspaceId)
  if (!orgId) return NextResponse.json({ error: 'Workspace no encontrado' }, { status: 404 })

  const waiting = await listLobby(admin, orgId)
  return NextResponse.json({ waiting })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  if (!isUuid(params.workspaceId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const auth = await isWorkspaceAdminById(params.workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = assignSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }
  const { profile_id, role, space_id, team_id } = parsed.data

  const admin = createAdminClient()
  const orgId = await orgIdOfWorkspace(admin, params.workspaceId)
  if (!orgId) return NextResponse.json({ error: 'Workspace no encontrado' }, { status: 404 })

  // El perfil debe pertenecer a la MISMA organizacion.
  const { data: profile } = (await admin
    .from('profiles')
    .select('org_id')
    .eq('id', profile_id)
    .maybeSingle()) as { data: { org_id: string | null } | null; error: unknown }
  if (!profile || profile.org_id !== orgId) {
    return NextResponse.json({ error: 'El usuario no pertenece a esta organización' }, { status: 422 })
  }

  // Departamento (opcional): debe vivir en este workspace.
  if (space_id) {
    const { data: dept } = (await admin
      .from('spaces')
      .select('id')
      .eq('id', space_id)
      .eq('workspace_id', params.workspaceId)
      .maybeSingle()) as { data: { id: string } | null; error: unknown }
    if (!dept) return NextResponse.json({ error: 'El departamento no pertenece a este workspace' }, { status: 422 })
  }

  // Equipo (opcional): debe vivir en este workspace y, si se dio depto, en ese depto.
  if (team_id) {
    const { data: team } = (await admin
      .from('teams')
      .select('id, space_id')
      .eq('id', team_id)
      .eq('workspace_id', params.workspaceId)
      .maybeSingle()) as { data: { id: string; space_id: string | null } | null; error: unknown }
    if (!team) return NextResponse.json({ error: 'El equipo no pertenece a este workspace' }, { status: 422 })
    if (space_id && team.space_id !== space_id) {
      return NextResponse.json({ error: 'El equipo no pertenece al departamento elegido' }, { status: 422 })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any

  // 1. Membresia del workspace (idempotente).
  const { error: wsErr } = await db
    .from('workspace_members')
    .upsert(
      { workspace_id: params.workspaceId, profile_id, role },
      { onConflict: 'workspace_id,profile_id' }
    )
  if (wsErr) {
    console.error('[lobby assign] workspace_members error:', wsErr)
    return NextResponse.json({ error: 'Error al asignar al workspace' }, { status: 500 })
  }

  // 2. Departamento (opcional, idempotente).
  if (space_id) {
    await db
      .from('space_members')
      .upsert(
        { space_id, profile_id, role: 'member', added_by: auth.userId },
        { onConflict: 'space_id,profile_id', ignoreDuplicates: true }
      )
  }

  // 3. Equipo (opcional, idempotente).
  if (team_id) {
    await db
      .from('team_members')
      .upsert(
        { team_id, profile_id, role: 'member' },
        { onConflict: 'team_id,profile_id', ignoreDuplicates: true }
      )
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}

// ── Helper: perfiles de la org sin acceso a ningun workspace ──────────────────
async function listLobby(
  admin: ReturnType<typeof createAdminClient>,
  orgId: string
) {
  type Prof = {
    id: string
    display_name: string | null
    email: string | null
    avatar_url: string | null
    created_at: string
  }
  const { data: profiles } = (await admin
    .from('profiles')
    .select('id, display_name, email, avatar_url, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: true })
    .limit(500)) as { data: Prof[] | null; error: unknown }

  const ids = (profiles ?? []).map((p) => p.id)
  if (ids.length === 0) return []

  const { data: memberRows } = (await admin
    .from('workspace_members')
    .select('profile_id')
    .in('profile_id', ids)) as { data: { profile_id: string }[] | null; error: unknown }

  const placed = new Set((memberRows ?? []).map((r) => r.profile_id))

  return (profiles ?? [])
    .filter((p) => !placed.has(p.id))
    .map((p) => ({
      profile_id: p.id,
      display_name: p.display_name ?? 'Usuario',
      email: p.email ?? '',
      avatar_url: p.avatar_url ?? null,
      created_at: p.created_at,
    }))
}

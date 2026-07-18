/**
 * PATCH  /api/teams/[teamId]/members/[profileId]  -> cambia el rol (admin | member)
 * DELETE /api/teams/[teamId]/members/[profileId]  -> quita al miembro del equipo
 *
 * Solo admins del workspace. No dejar el equipo sin admins.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

const patchSchema = z.object({ role: z.enum(['admin', 'member']) }).strict()

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

async function adminCount(admin: ReturnType<typeof createAdminClient>, teamId: string): Promise<number> {
  const { count } = (await admin
    .from('team_members')
    .select('profile_id', { count: 'exact', head: true })
    .eq('team_id', teamId)
    .eq('role', 'admin')) as { count: number | null }
  return count ?? 0
}

async function currentRole(
  admin: ReturnType<typeof createAdminClient>,
  teamId: string,
  profileId: string
): Promise<string | null> {
  const { data } = (await admin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', profileId)
    .maybeSingle()) as { data: { role: string } | null }
  return data?.role ?? null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { teamId: string; profileId: string } }
) {
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
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Rol inválido' }, { status: 422 })

  const prev = await currentRole(admin, params.teamId, params.profileId)
  if (!prev) return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })

  if (prev === 'admin' && parsed.data.role !== 'admin' && (await adminCount(admin, params.teamId)) <= 1) {
    return NextResponse.json({ error: 'Debe quedar al menos un admin' }, { status: 409 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('team_members')
    .update({ role: parsed.data.role })
    .eq('team_id', params.teamId)
    .eq('profile_id', params.profileId)

  if (error) return NextResponse.json({ error: 'Error al actualizar el rol' }, { status: 500 })
  return NextResponse.json({ ok: true, role: parsed.data.role })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { teamId: string; profileId: string } }
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const admin = createAdminClient()
  const workspaceId = await teamWorkspace(admin, params.teamId)
  if (!workspaceId) return NextResponse.json({ error: 'Equipo no encontrado' }, { status: 404 })

  const auth = await isWorkspaceAdminById(workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  const prev = await currentRole(admin, params.teamId, params.profileId)
  if (!prev) return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })

  if (prev === 'admin' && (await adminCount(admin, params.teamId)) <= 1) {
    return NextResponse.json({ error: 'Debe quedar al menos un admin' }, { status: 409 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('team_members')
    .delete()
    .eq('team_id', params.teamId)
    .eq('profile_id', params.profileId)

  if (error) return NextResponse.json({ error: 'Error al quitar el miembro' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

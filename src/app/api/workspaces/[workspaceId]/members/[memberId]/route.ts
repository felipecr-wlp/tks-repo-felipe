/**
 * PATCH  /api/workspaces/[workspaceId]/members/[memberId]  -> cambia el rol (memberId = profile_id)
 * DELETE /api/workspaces/[workspaceId]/members/[memberId]  -> quita al miembro del workspace
 *
 * Solo admins. Guardas de integridad: nunca dejar el workspace sin owners y no
 * permitir que un admin se quite a si mismo (evita bloqueos accidentales).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

const ROLES = ['owner', 'admin', 'manager', 'member', 'viewer'] as const
const patchSchema = z.object({ role: z.enum(ROLES) }).strict()

async function ownerCount(admin: ReturnType<typeof createAdminClient>, workspaceId: string): Promise<number> {
  const { count } = (await admin
    .from('workspace_members')
    .select('profile_id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('role', 'owner')) as { count: number | null }
  return count ?? 0
}

async function currentRole(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  profileId: string
): Promise<string | null> {
  const { data } = (await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', profileId)
    .maybeSingle()) as { data: { role: string } | null }
  return data?.role ?? null
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { workspaceId: string; memberId: string } }
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const auth = await isWorkspaceAdminById(params.workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalido' }, { status: 400 })
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: 'Rol invalido' }, { status: 422 })

  const admin = createAdminClient()
  const prev = await currentRole(admin, params.workspaceId, params.memberId)
  if (!prev) return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })

  // No dejar el workspace sin owners
  if (prev === 'owner' && parsed.data.role !== 'owner' && (await ownerCount(admin, params.workspaceId)) <= 1) {
    return NextResponse.json({ error: 'Debe quedar al menos un owner' }, { status: 409 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('workspace_members')
    .update({ role: parsed.data.role })
    .eq('workspace_id', params.workspaceId)
    .eq('profile_id', params.memberId)

  if (error) return NextResponse.json({ error: 'Error al actualizar el rol' }, { status: 500 })
  return NextResponse.json({ ok: true, role: parsed.data.role })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { workspaceId: string; memberId: string } }
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const auth = await isWorkspaceAdminById(params.workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  if (auth.userId === params.memberId)
    return NextResponse.json({ error: 'No puedes quitarte a ti mismo' }, { status: 409 })

  const admin = createAdminClient()
  const prev = await currentRole(admin, params.workspaceId, params.memberId)
  if (!prev) return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })

  if (prev === 'owner' && (await ownerCount(admin, params.workspaceId)) <= 1) {
    return NextResponse.json({ error: 'Debe quedar al menos un owner' }, { status: 409 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('workspace_members')
    .delete()
    .eq('workspace_id', params.workspaceId)
    .eq('profile_id', params.memberId)

  if (error) return NextResponse.json({ error: 'Error al quitar el miembro' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

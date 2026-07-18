/**
 * DELETE /api/spaces/[spaceId]/members/[profileId]  -> quita al miembro del departamento
 *
 * Solo admins del workspace. No dejar el departamento sin owners.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

async function spaceWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  spaceId: string
): Promise<string | null> {
  const { data } = (await admin
    .from('spaces')
    .select('workspace_id')
    .eq('id', spaceId)
    .maybeSingle()) as { data: { workspace_id: string } | null; error: unknown }
  return data?.workspace_id ?? null
}

async function ownerCount(admin: ReturnType<typeof createAdminClient>, spaceId: string): Promise<number> {
  const { count } = (await admin
    .from('space_members')
    .select('profile_id', { count: 'exact', head: true })
    .eq('space_id', spaceId)
    .eq('role', 'owner')) as { count: number | null }
  return count ?? 0
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { spaceId: string; profileId: string } }
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const admin = createAdminClient()
  const workspaceId = await spaceWorkspace(admin, params.spaceId)
  if (!workspaceId) return NextResponse.json({ error: 'Departamento no encontrado' }, { status: 404 })

  const auth = await isWorkspaceAdminById(workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  const { data: member } = (await admin
    .from('space_members')
    .select('role')
    .eq('space_id', params.spaceId)
    .eq('profile_id', params.profileId)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }
  if (!member) return NextResponse.json({ error: 'Miembro no encontrado' }, { status: 404 })

  if (member.role === 'owner' && (await ownerCount(admin, params.spaceId)) <= 1) {
    return NextResponse.json({ error: 'Debe quedar al menos un owner' }, { status: 409 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('space_members')
    .delete()
    .eq('space_id', params.spaceId)
    .eq('profile_id', params.profileId)

  if (error) return NextResponse.json({ error: 'Error al quitar el miembro' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/**
 * PATCH /api/teams/[teamId], Actualiza nombre o descripción del equipo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

const patchSchema = z.object({
  name:        z.string().min(2).max(80).trim().optional(),
  description: z.string().max(300).trim().nullable().optional(),
  methodology: z.enum(['scrum', 'kanban']).optional(),
}).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: { teamId: string } }
) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()

  // Solo admins del equipo
  const { data: membership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', params.teamId)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })
  }

  type TeamResult = { id: string; name: string; slug: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = await (admin as any)
    .from('teams')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.teamId)
    .select('id, name, slug')
    .single() as { data: TeamResult | null; error: unknown }

  if (error || !updated) return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })
  return NextResponse.json(updated)
}

/**
 * DELETE /api/teams/[teamId], Elimina el equipo. Solo admins del workspace.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { teamId: string } }
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const admin = createAdminClient()

  const { data: team } = (await admin
    .from('teams')
    .select('workspace_id')
    .eq('id', params.teamId)
    .maybeSingle()) as { data: { workspace_id: string } | null; error: unknown }
  if (!team) return NextResponse.json({ error: 'Equipo no encontrado' }, { status: 404 })

  const auth = await isWorkspaceAdminById(team.workspace_id)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('teams').delete().eq('id', params.teamId)
  if (error) return NextResponse.json({ error: 'Error al eliminar el equipo' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

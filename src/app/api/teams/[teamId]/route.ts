/**
 * PATCH /api/teams/[teamId], Actualiza nombre o descripción del equipo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

const patchSchema = z.object({
  name:        z.string().min(2).max(80).trim().optional(),
  description: z.string().max(300).trim().nullable().optional(),
  methodology: z.enum(['scrum', 'kanban']).optional(),
  is_archived: z.boolean().optional(),
  // Reasignar departamento (space) o soltarlo (null).
  space_id:    z.string().uuid().nullable().optional(),
  // Limites WIP por categoria de columna (Kanban). null en una categoria =
  // usar el limite sano derivado. Enteros 1..99.
  wip_limits:  z.object({
    todo:        z.number().int().min(1).max(99).nullable().optional(),
    in_progress: z.number().int().min(1).max(99).nullable().optional(),
    done:        z.number().int().min(1).max(99).nullable().optional(),
  }).strict().nullable().optional(),
}).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: { teamId: string } }
) {
  if (!isUuid(params.teamId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
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

  // Obtener el workspace del equipo para permitir tanto a admins del equipo
  // como a administradores del workspace (los que activan/desactivan equipos).
  const { data: team } = await admin
    .from('teams')
    .select('workspace_id')
    .eq('id', params.teamId)
    .maybeSingle() as { data: { workspace_id: string } | null; error: unknown }
  if (!team) return NextResponse.json({ error: 'Equipo no encontrado' }, { status: 404 })

  const { data: membership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', params.teamId)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  const isTeamAdmin = membership?.role === 'admin'
  if (!isTeamAdmin) {
    const adminCtx = await isWorkspaceAdminById(team.workspace_id)
    if (!adminCtx?.isAdmin) {
      return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })
    }
  }

  // Reasignar departamento: solo administradores del workspace (no un team admin
  // regular) y el departamento debe vivir en el mismo workspace.
  if ('space_id' in parsed.data) {
    const adminCtx = await isWorkspaceAdminById(team.workspace_id)
    if (!adminCtx?.isAdmin) {
      return NextResponse.json({ error: 'Solo un administrador del workspace puede mover el equipo de departamento' }, { status: 403 })
    }
    if (parsed.data.space_id) {
      const { data: dept } = await admin
        .from('spaces')
        .select('id')
        .eq('id', parsed.data.space_id)
        .eq('workspace_id', team.workspace_id)
        .maybeSingle() as { data: { id: string } | null; error: unknown }
      if (!dept) {
        return NextResponse.json({ error: 'El departamento no pertenece a este workspace' }, { status: 422 })
      }
    }
  }

  type TeamResult = { id: string; name: string; slug: string; is_archived: boolean }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = await (admin as any)
    .from('teams')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.teamId)
    .select('id, name, slug, is_archived')
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
  if (!isUuid(params.teamId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
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

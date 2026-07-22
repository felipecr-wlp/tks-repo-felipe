/**
 * PATCH  /api/sprints/[sprintId], Actualiza un sprint (nombre, meta, estado, fechas)
 * DELETE /api/sprints/[sprintId], Elimina un sprint. Las tareas NO se borran:
 *                                   sprint_id pasa a NULL (vuelven al backlog) por
 *                                   el ON DELETE SET NULL del FK.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const patchSchema = z.object({
  name:       z.string().min(1).max(120).trim().optional(),
  goal:       z.string().max(500).nullable().optional(),
  status:     z.enum(['planning', 'active', 'completed']).optional(),
  start_date: z.string().nullable().optional(),
  end_date:   z.string().nullable().optional(),
}).strict()

async function authorize(sprintId: string, userId: string) {
  const admin = createAdminClient()
  type SprintRow = { id: string; team_id: string }
  const { data: sprint } = await admin
    .from('sprints')
    .select('id, team_id')
    .eq('id', sprintId)
    .maybeSingle() as { data: SprintRow | null; error: unknown }

  if (!sprint) return { ok: false as const, status: 404, error: 'Sprint no encontrado' }

  const { data: membership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', sprint.team_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return { ok: false as const, status: 403, error: 'Sin acceso al equipo' }
  return { ok: true as const, admin, sprint }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { sprintId: string } }
) {
  if (!isUuid(params.sprintId)) {
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

  const auth = await authorize(params.sprintId, user.id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  const payload: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() }
  if ('start_date' in payload && !payload.start_date) payload.start_date = null
  if ('end_date' in payload && !payload.end_date) payload.end_date = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = await (auth.admin as any)
    .from('sprints')
    .update(payload)
    .eq('id', params.sprintId)
    .select('id, name, goal, status, start_date, end_date, created_at')
    .single()

  if (error || !updated) {
    console.error('[sprints PATCH] error:', error)
    return NextResponse.json({ error: 'Error al actualizar el sprint' }, { status: 500 })
  }

  return NextResponse.json(updated)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { sprintId: string } }
) {
  if (!isUuid(params.sprintId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const auth = await authorize(params.sprintId, user.id)
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (auth.admin as any)
    .from('sprints')
    .delete()
    .eq('id', params.sprintId)

  if (error) {
    console.error('[sprints DELETE] error:', error)
    return NextResponse.json({ error: 'Error al eliminar el sprint' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

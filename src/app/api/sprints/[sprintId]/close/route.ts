/**
 * POST /api/sprints/[sprintId]/close, cierra un sprint con carry-over.
 *
 * Marca el sprint como 'completed' y reubica las tareas INCOMPLETAS (cuyo estado
 * NO es de categoria 'done') que quedaron en el. El destino lo decide el body:
 *   { carry_to: "<sprintId>" }  -> las manda a ese sprint (siguiente sprint)
 *   { carry_to: null } | vacio  -> las devuelve al backlog (sprint_id = NULL)
 *
 * Las tareas ya terminadas (categoria 'done') se quedan en el sprint cerrado
 * como registro historico de lo logrado. Sprint es team-scoped; autorizacion
 * manual con admin client (bypass RLS) + team_members, mismo molde que el resto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { sprintId: string }
}

const bodySchema = z.object({
  carry_to: z.string().uuid().nullable().optional(),
}).strict()

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.sprintId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let raw: unknown = {}
  try { raw = await request.json() }
  catch { /* body opcional: sin cuerpo = carry_to al backlog */ }

  const parsed = bodySchema.safeParse(raw ?? {})
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }
  const carryTo = parsed.data.carry_to ?? null

  const admin = createAdminClient()

  // Sprint a cerrar + acceso al equipo.
  type SprintRow = { id: string; team_id: string; status: string }
  const { data: sprint } = await admin
    .from('sprints')
    .select('id, team_id, status')
    .eq('id', params.sprintId)
    .maybeSingle() as { data: SprintRow | null; error: unknown }

  if (!sprint) return NextResponse.json({ error: 'Sprint no encontrado' }, { status: 404 })

  const { data: membership, error: membershipErr } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', sprint.team_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  // Distinguir fallo de lectura (500) de ausencia real de membresia (403): si la
  // consulta erro, devolver null como "sin acceso" seria un 403 falso.
  if (membershipErr) {
    console.error('[sprint close] membership read error:', membershipErr)
    return NextResponse.json({ error: 'Error al verificar acceso' }, { status: 500 })
  }
  if (!membership) return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })

  // Validar el destino cuando se pide carry-over a otro sprint.
  if (carryTo) {
    if (carryTo === params.sprintId) {
      return NextResponse.json({ error: 'El sprint destino no puede ser el mismo' }, { status: 422 })
    }
    type TargetRow = { id: string; team_id: string; status: string }
    const { data: target } = await admin
      .from('sprints')
      .select('id, team_id, status')
      .eq('id', carryTo)
      .maybeSingle() as { data: TargetRow | null; error: unknown }

    if (!target || target.team_id !== sprint.team_id) {
      return NextResponse.json({ error: 'Sprint destino no válido' }, { status: 422 })
    }
    if (target.status === 'completed') {
      return NextResponse.json({ error: 'No se puede mover a un sprint ya cerrado' }, { status: 422 })
    }
  }

  // Tareas del sprint con su categoria de estado, para separar hechas de incompletas.
  type TaskRow = { id: string; status: { category: string } | null }
  const { data: tasks, error: tasksErr } = await admin
    .from('tasks')
    .select('id, status:task_statuses ( category )')
    .eq('sprint_id', params.sprintId)
    .eq('is_archived', false) as { data: TaskRow[] | null; error: unknown }

  // Si la lectura de tareas falla, abortar: cerrar aqui dejaria las incompletas
  // huerfanas dentro del sprint cerrado y reportaria carried 0 erroneamente.
  if (tasksErr) {
    console.error('[sprint close] tasks read error:', tasksErr)
    return NextResponse.json({ error: 'Error al leer las tareas del sprint' }, { status: 500 })
  }

  const rows = tasks ?? []
  // Terminal = done o cancelled: ninguna se arrastra. Una tarea cancelada ya no
  // se va a trabajar, asi que se queda en el sprint cerrado (no infla el carry).
  const incomplete = rows
    .filter(t => { const c = t.status?.category ?? ''; return c !== 'done' && c !== 'cancelled' })
    .map(t => t.id)
  const doneCount = rows.filter(t => t.status?.category === 'done').length

  // Reubicar incompletas (al backlog o al sprint destino) en un solo update.
  if (incomplete.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: moveErr } = await (admin as any)
      .from('tasks')
      .update({ sprint_id: carryTo, updated_at: new Date().toISOString() })
      .in('id', incomplete)
    if (moveErr) {
      console.error('[sprint close] move error:', moveErr)
      return NextResponse.json({ error: 'Error al reubicar las tareas' }, { status: 500 })
    }
  }

  // Cerrar el sprint.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = await (admin as any)
    .from('sprints')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', params.sprintId)
    .select('id, name, goal, status, start_date, end_date, created_at')
    .single()

  if (error || !updated) {
    console.error('[sprint close] update error:', error)
    return NextResponse.json({ error: 'Error al cerrar el sprint' }, { status: 500 })
  }

  return NextResponse.json({
    sprint: updated,
    carried: incomplete.length,
    done: doneCount,
    carry_to: carryTo,
  })
}

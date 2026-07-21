/**
 * GET    /api/tasks/[taskId], Detalle completo de una tarea
 * PATCH  /api/tasks/[taskId], Actualiza campos de una tarea
 * DELETE /api/tasks/[taskId], Archiva una tarea (soft delete)
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, notify, ActivityVerbs, NotificationTypes, notifyTaskWatchers } from '@/lib/activity'
import { autoWatch } from '@/lib/watchers'
import { nextRecurrenceDate, type RecurrenceRule } from '@/lib/recurrence'
import { runAutomations } from '@/lib/automations'

// ── GET: detalle completo ─────────────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  type TaskFull = {
    id: string; title: string; description: string | null; priority: string
    due_date: string | null; start_date: string | null; estimate_minutes: number | null
    sort_order: string; created_at: string; updated_at: string
    project_id: string
    recurrence_rule: string | null; recurrence_end_date: string | null
    status: { id: string; name: string; color: string | null; category: string } | null
    assignee: { id: string; display_name: string; avatar_url: string | null } | null
    created_by_profile: { id: string; display_name: string; avatar_url: string | null } | null
    parent: { id: string; title: string } | null
  }
  const { data: task } = await admin
    .from('tasks')
    .select(`
      id, title, description, priority, due_date, start_date, estimate_minutes, sort_order, created_at, updated_at, project_id,
      recurrence_rule, recurrence_end_date,
      status:task_statuses ( id, name, color, category ),
      assignee:profiles!tasks_assignee_id_fkey ( id, display_name, avatar_url ),
      created_by_profile:profiles!tasks_created_by_fkey ( id, display_name, avatar_url ),
      parent:tasks ( id, title )
    `)
    .eq('id', params.taskId)
    .eq('is_archived', false)
    .maybeSingle() as { data: TaskFull | null; error: unknown }

  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

  // Verificar acceso al proyecto
  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', task.project_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  return NextResponse.json(task)
}

const SP_VALUES = [1, 2, 3, 5, 8, 13, 21] as const

const patchSchema = z.object({
  title:       z.string().min(1).max(500).trim().optional(),
  description: z.string().nullable().optional(),
  status_id:   z.string().uuid().nullable().optional(),
  priority:    z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date:    z.string().datetime().nullable().optional(),
  start_date:  z.string().datetime().nullable().optional(),
  estimate_minutes: z.number().int().min(0).max(1000000).nullable().optional(),
  sort_order:  z.string().optional(),
  // ── Capa SCRUM ──────────────────────────────────────────────
  sprint_id:         z.string().uuid().nullable().optional(),
  story_points:      z.number().refine(n => (SP_VALUES as readonly number[]).includes(n), 'Fibonacci 1,2,3,5,8,13,21').nullable().optional(),
  story_points_done: z.number().refine(n => (SP_VALUES as readonly number[]).includes(n), 'Fibonacci 1,2,3,5,8,13,21').nullable().optional(),
  area:              z.string().max(60).nullable().optional(),
  // ── Recurrencia (Circuito B26) ─────────────────────────────
  recurrence_rule:      z.enum(['daily', 'weekly', 'biweekly', 'monthly']).nullable().optional(),
  recurrence_end_date:  z.string().datetime().nullable().optional(),
}).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: { taskId: string } }
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

  type TaskCheck = {
    id: string; project_id: string; workspace_id: string; title: string
    status_id: string | null; due_date: string | null; priority: string
    assignee_id: string | null
    recurrence_rule: string | null; recurrence_end_date: string | null
  }
  const { data: existing } = await admin
    .from('tasks')
    .select('id, project_id, workspace_id, title, status_id, due_date, priority, assignee_id, recurrence_rule, recurrence_end_date')
    .eq('id', params.taskId)
    .maybeSingle() as { data: TaskCheck | null; error: unknown }

  if (!existing) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', existing.project_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  type TaskUpdateResult = {
    id: string
    title: string
    description: string | null
    priority: string
    due_date: string | null
    start_date: string | null
    estimate_minutes: number | null
    sort_order: string
    created_at: string
    updated_at: string
    recurrence_rule: string | null
    recurrence_end_date: string | null
    status: { id: string; name: string; color: string | null; category: string } | null
    assignee: { id: string; display_name: string; avatar_url: string | null } | null
    created_by_profile: { id: string; display_name: string; avatar_url: string | null } | null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error: updateError } = await (admin as any)
    .from('tasks')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.taskId)
    .select(`
      id, title, description, priority, due_date, start_date, estimate_minutes, sort_order, created_at, updated_at,
      recurrence_rule, recurrence_end_date,
      status:task_statuses ( id, name, color, category ),
      assignee:profiles!tasks_assignee_id_fkey ( id, display_name, avatar_url ),
      created_by_profile:profiles!tasks_created_by_fkey ( id, display_name, avatar_url )
    `)
    .single() as { data: TaskUpdateResult | null; error: unknown }

  if (updateError || !updated) {
    console.error('[tasks PATCH] update error:', updateError)
    return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })
  }

  logActivity({
    verb: ActivityVerbs.TASK_UPDATED,
    subject_id: user.id,
    object_type: 'task',
    object_id: updated.id,
    object_title: updated.title,
    workspace_id: existing.workspace_id,
    project_id: existing.project_id,
    metadata: parsed.data,
  }).catch(console.error)

  // Notificar a los seguidores de la tarea (menos al actor). Best effort.
  notifyTaskWatchers({
    taskId: updated.id,
    actorId: user.id,
    taskTitle: updated.title,
    workspaceId: existing.workspace_id,
  }).catch(console.error)

  // ── Asignacion (Circuito 2.A) ─────────────────────────────────────────────
  // Si este PATCH cambio el asignado a una persona distinta (y no es el propio
  // actor), avisarle directo a su Bandeja + correo (opt-out). Ademas lo pone a
  // seguir la tarea para futuros cambios. Best effort, no bloquea la respuesta.
  const assigneeChanged =
    parsed.data.assignee_id !== undefined &&
    parsed.data.assignee_id !== existing.assignee_id
  const newAssignee = parsed.data.assignee_id
  if (assigneeChanged && newAssignee && newAssignee !== user.id) {
    autoWatch(admin, updated.id, existing.project_id, newAssignee).catch(console.error)
    notify({
      recipient_id: newAssignee,
      subject_id:   user.id,
      type:         NotificationTypes.TASK_ASSIGNED,
      object_type:  'task',
      object_id:    updated.id,
      object_title: updated.title,
      workspace_id: existing.workspace_id,
    }).catch(console.error)
  }

  // ── Recurrencia (Circuito B26) ────────────────────────────────────────────
  // Si esta PATCH movio la tarea a un estado categoria 'done' y la tarea (o
  // el propio PATCH) trae una regla de recurrencia activa, clonar la tarea
  // con la fecha de vencimiento avanzada segun la regla. Solo dispara cuando
  // el PATCH realmente cambio el estado (evita re-clonar en cada edicion
  // menor de una tarea ya completada).
  const statusChanged = parsed.data.status_id !== undefined && parsed.data.status_id !== existing.status_id
  const effectiveRule = (parsed.data.recurrence_rule !== undefined ? parsed.data.recurrence_rule : existing.recurrence_rule) as RecurrenceRule | null
  const effectiveEnd = parsed.data.recurrence_end_date !== undefined ? parsed.data.recurrence_end_date : existing.recurrence_end_date

  let spawnedTaskId: string | null = null
  if (statusChanged && updated.status?.category === 'done' && effectiveRule) {
    const baseDate = existing.due_date ? new Date(existing.due_date) : new Date()
    const nextDue = nextRecurrenceDate(effectiveRule, baseDate)

    const seriesEnded = effectiveEnd ? nextDue > new Date(effectiveEnd) : false

    if (!seriesEnded) {
      // Primer estado del proyecto (columna "todo") para la nueva ocurrencia
      type StatusRow = { id: string }
      const { data: firstStatus } = await admin
        .from('task_statuses')
        .select('id')
        .eq('project_id', existing.project_id)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle() as { data: StatusRow | null; error: unknown }

      type SortRow = { sort_order: string }
      let lastTaskQuery = admin
        .from('tasks')
        .select('sort_order')
        .eq('project_id', existing.project_id)
        .order('sort_order', { ascending: false })
        .limit(1)
      lastTaskQuery = firstStatus?.id
        ? lastTaskQuery.eq('status_id', firstStatus.id)
        : lastTaskQuery.is('status_id', null)
      const { data: lastTask } = await lastTaskQuery.maybeSingle() as { data: SortRow | null; error: unknown }

      const { generateKeyBetween } = await import('fractional-indexing')
      const sortOrder = generateKeyBetween(lastTask?.sort_order ?? null, null)

      const nextAssignee = updated.assignee?.id ?? existing.assignee_id ?? null

      type SpawnResult = { id: string; title: string }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: spawned, error: spawnError } = await (admin as any)
        .from('tasks')
        .insert({
          project_id: existing.project_id,
          workspace_id: existing.workspace_id,
          title: updated.title,
          status_id: firstStatus?.id ?? null,
          priority: updated.priority,
          assignee_id: nextAssignee,
          due_date: nextDue.toISOString(),
          recurrence_rule: effectiveRule,
          recurrence_end_date: effectiveEnd,
          sort_order: sortOrder,
          created_by: user.id,
        })
        .select('id, title')
        .single() as { data: SpawnResult | null; error: unknown }

      if (spawnError) {
        console.error('[tasks PATCH] recurrence spawn error:', spawnError)
      } else if (spawned) {
        spawnedTaskId = spawned.id

        logActivity({
          verb: ActivityVerbs.TASK_CREATED,
          subject_id: user.id,
          object_type: 'task',
          object_id: spawned.id,
          object_title: spawned.title,
          workspace_id: existing.workspace_id,
          project_id: existing.project_id,
          metadata: { recurrence_of: updated.id, recurrence_rule: effectiveRule },
        }).catch(console.error)

        autoWatch(admin, spawned.id, existing.project_id, user.id).catch(console.error)
        if (nextAssignee && nextAssignee !== user.id) {
          autoWatch(admin, spawned.id, existing.project_id, nextAssignee).catch(console.error)

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(admin as any).from('notifications').insert({
            workspace_id: existing.workspace_id,
            recipient_id: nextAssignee,
            subject_id: null, // generado por el sistema de recurrencia, no por el actor
            type: NotificationTypes.TASK_RECURRENCE_CREATED,
            object_type: 'task',
            object_id: spawned.id,
            object_title: spawned.title,
          }).then(() => {}).catch(console.error)
        }
      }
    }
  }

  // ── Automatizaciones (Circuito 3.B): disparadores de estado y asignacion ──
  // Corren las reglas activas del proyecto cuando este PATCH cambio el estado
  // (status_changed) o el asignado (assigned). Best effort, secuencial para no
  // pisar la misma tarea, y sin re-entrar al motor (las acciones escriben
  // directo con el admin client). No bloquea la respuesta.
  if (statusChanged || assigneeChanged) {
    const snapshot = {
      id: updated.id,
      project_id: existing.project_id,
      workspace_id: existing.workspace_id,
      title: updated.title,
      status_id: updated.status?.id ?? null,
      assignee_id: updated.assignee?.id ?? null,
      priority: updated.priority,
      due_date: updated.due_date,
      sprint_id: parsed.data.sprint_id ?? undefined,
    }
    ;(async () => {
      if (statusChanged) {
        await runAutomations({ admin, event: 'status_changed', actorId: user.id, task: snapshot })
      }
      if (assigneeChanged) {
        await runAutomations({ admin, event: 'assigned', actorId: user.id, task: snapshot })
      }
    })().catch(console.error)
  }

  return NextResponse.json({ ...updated, spawned_task_id: spawnedTaskId })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  type TaskCheck = { id: string; project_id: string; workspace_id: string; title: string }
  const { data: existing } = await admin
    .from('tasks')
    .select('id, project_id, workspace_id, title')
    .eq('id', params.taskId)
    .maybeSingle() as { data: TaskCheck | null; error: unknown }

  if (!existing) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', existing.project_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Soft delete (archivar)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: archiveError } = await (admin as any)
    .from('tasks')
    .update({ is_archived: true, updated_at: new Date().toISOString() })
    .eq('id', params.taskId)

  if (archiveError) {
    console.error('[tasks DELETE] archive error:', archiveError)
    return NextResponse.json({ error: 'Error al eliminar' }, { status: 500 })
  }

  logActivity({
    verb: ActivityVerbs.TASK_DELETED,
    subject_id: user.id,
    object_type: 'task',
    object_id: existing.id,
    object_title: existing.title,
    workspace_id: existing.workspace_id,
    project_id: existing.project_id,
  }).catch(console.error)

  return NextResponse.json({ success: true })
}

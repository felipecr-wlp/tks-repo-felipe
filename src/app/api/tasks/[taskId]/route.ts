/**
 * GET    /api/tasks/[taskId], Detalle completo de una tarea
 * PATCH  /api/tasks/[taskId], Actualiza campos de una tarea
 * DELETE /api/tasks/[taskId], Archiva una tarea (soft delete)
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { sanitizeRichText } from '@/lib/sanitize'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, logActivityCoalesced, notify, ActivityVerbs, NotificationTypes, notifyTaskWatchers } from '@/lib/activity'
import { autoWatch } from '@/lib/watchers'
import { nextRecurrenceDate, type RecurrenceRule } from '@/lib/recurrence'
import { runAutomations } from '@/lib/automations'
import { canAccessProject, isAssignableToProject } from '@/lib/team-access'

// ── GET: detalle completo ─────────────────────────────────────────────────────
export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  type TaskFull = {
    id: string; title: string; description: string | null; priority: string
    due_date: string | null; start_date: string | null; estimate_minutes: number | null
    story_points: number | null; story_points_done: number | null
    sort_order: string; created_at: string; updated_at: string
    project_id: string
    parent_task_id: string | null
    recurrence_rule: string | null; recurrence_end_date: string | null
    status: { id: string; name: string; color: string | null; category: string } | null
    assignee: { id: string; display_name: string; avatar_url: string | null } | null
    created_by_profile: { id: string; display_name: string; avatar_url: string | null } | null
  }
  // NO se usa embed autorreferente `parent:tasks` a proposito: PostgREST resuelve
  // las relaciones contra su cache de esquema y la self-FK tasks->tasks se le
  // pierde de la cache (PGRST200 "Could not find a relationship ... in the schema
  // cache") aunque el constraint exista en la BD, tumbando el GET con 500 ("No se
  // pudo cargar la tarea"). Se trae solo `parent_task_id` y, si hay padre, se
  // resuelve su titulo con una segunda consulta trivial: robusto ante cache stale.
  const { data: task, error: taskError } = await admin
    .from('tasks')
    .select(`
      id, title, description, priority, due_date, start_date, estimate_minutes, story_points, story_points_done, sort_order, created_at, updated_at, project_id, parent_task_id,
      recurrence_rule, recurrence_end_date,
      status:task_statuses ( id, name, color, category ),
      assignee:profiles!tasks_assignee_id_fkey ( id, display_name, avatar_url ),
      created_by_profile:profiles!tasks_created_by_fkey ( id, display_name, avatar_url )
    `)
    .eq('id', params.taskId)
    .eq('is_archived', false)
    .maybeSingle() as { data: TaskFull | null; error: unknown }

  // No tragarse el error: si la consulta falla (embed, permisos, etc.) se
  // devuelve 500 con detalle en logs en vez de un 404 enganoso.
  if (taskError) {
    console.error('[tasks GET] query error:', taskError)
    return NextResponse.json({ error: 'No se pudo cargar la tarea' }, { status: 500 })
  }
  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

  // Verificar acceso al proyecto (miembro del proyecto O admin del workspace/org)
  const { ok: canAccess } = await canAccessProject(admin, task.project_id, user.id)
  if (!canAccess) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Resolver el padre (id + titulo) con una consulta separada solo si aplica,
  // preservando la forma de respuesta { ...task, parent } que espera el panel.
  let parent: { id: string; title: string } | null = null
  if (task.parent_task_id) {
    const { data: parentRow } = await admin
      .from('tasks')
      .select('id, title')
      .eq('id', task.parent_task_id)
      .maybeSingle() as { data: { id: string; title: string } | null; error: unknown }
    parent = parentRow ?? null
  }

  return NextResponse.json({ ...task, parent })
}

const SP_VALUES = [1, 2, 3, 5, 8, 13, 21] as const

const patchSchema = z.object({
  title:       z.string().min(1).max(500).trim().optional(),
  description: z.string().max(20000).nullable().optional(),
  status_id:   z.string().uuid().nullable().optional(),
  priority:    z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date:    z.string().datetime().nullable().optional(),
  start_date:  z.string().datetime().nullable().optional(),
  estimate_minutes: z.number().int().min(0).max(1000000).nullable().optional(),
  sort_order:  z.string().max(100).optional(),
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
  if (!isUuid(params.taskId)) {
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

  // Defensa en profundidad anti stored-XSS: la descripcion es HTML del editor y
  // se re-renderiza en varias vistas (panel de tarea, impresion). Se sanea al
  // ESCRIBIR para que ningun payload inyectado por API persista, complementando
  // el saneado en render.
  if (typeof parsed.data.description === 'string') {
    parsed.data.description = sanitizeRichText(parsed.data.description)
  }

  const admin = createAdminClient()

  type TaskCheck = {
    id: string; project_id: string; workspace_id: string; title: string
    status_id: string | null; due_date: string | null; priority: string
    assignee_id: string | null
    recurrence_rule: string | null; recurrence_end_date: string | null
    status: { category: string } | null
  }
  const { data: existing } = await admin
    .from('tasks')
    .select('id, project_id, workspace_id, title, status_id, due_date, priority, assignee_id, recurrence_rule, recurrence_end_date, status:task_statuses ( category )')
    .eq('id', params.taskId)
    .maybeSingle() as { data: TaskCheck | null; error: unknown }

  if (!existing) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

  const { ok: canAccess } = await canAccessProject(admin, existing.project_id, user.id)
  if (!canAccess) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Validar el nuevo responsable: si este PATCH reasigna a una persona (no null),
  // debe ser miembro del proyecto. Impide reasignar a UUIDs arbitrarios o de otro
  // workspace. Se salta cuando no cambia el asignado o se limpia (null).
  if (
    parsed.data.assignee_id !== undefined &&
    parsed.data.assignee_id !== null &&
    parsed.data.assignee_id !== existing.assignee_id &&
    !(await isAssignableToProject(admin, existing.project_id, parsed.data.assignee_id))
  ) {
    return NextResponse.json({ error: 'El responsable no pertenece al proyecto' }, { status: 422 })
  }

  type TaskUpdateResult = {
    id: string
    title: string
    description: string | null
    priority: string
    due_date: string | null
    start_date: string | null
    estimate_minutes: number | null
    story_points: number | null
    story_points_done: number | null
    sort_order: string
    created_at: string
    updated_at: string
    recurrence_rule: string | null
    recurrence_end_date: string | null
    status: { id: string; name: string; color: string | null; category: string } | null
    assignee: { id: string; display_name: string; avatar_url: string | null } | null
    created_by_profile: { id: string; display_name: string; avatar_url: string | null } | null
  }

  const taskSelect = `
      id, title, description, priority, due_date, start_date, estimate_minutes, story_points, story_points_done, sort_order, created_at, updated_at,
      recurrence_rule, recurrence_end_date,
      status:task_statuses ( id, name, color, category ),
      assignee:profiles!tasks_assignee_id_fkey ( id, display_name, avatar_url ),
      created_by_profile:profiles!tasks_created_by_fkey ( id, display_name, avatar_url )
    `

  // ── Guard de concurrencia (optimistic) contra doble-spawn de recurrencia ──
  // Si este PATCH mueve el estado, la UPDATE se condiciona a que el status_id de
  // la fila SIGA siendo el que leimos (existing.status_id). Postgres serializa el
  // lock de fila: ante dos "completar" simultaneos, solo UNA request matchea y
  // avanza la transicion; la perdedora actualiza 0 filas y NO vuelve a clonar la
  // serie. Sin esto, dos requests casi simultaneas pasaban ambas el chequeo
  // enteredDone y generaban dos ocurrencias duplicadas.
  const isStatusTransition =
    parsed.data.status_id !== undefined && parsed.data.status_id !== existing.status_id

  let updateQuery = admin
    .from('tasks')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.taskId)
  if (isStatusTransition) {
    updateQuery = existing.status_id === null
      ? updateQuery.is('status_id', null)
      : updateQuery.eq('status_id', existing.status_id)
  }

  const { data: updated, error: updateError } = await updateQuery
    .select(taskSelect)
    .maybeSingle() as { data: TaskUpdateResult | null; error: unknown }

  if (updateError) {
    console.error('[tasks PATCH] update error:', updateError)
    return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })
  }

  // Sin error pero 0 filas: perdimos la carrera de una transicion de estado
  // concurrente (otra request ya la aplico, y ya clono la recurrencia si tocaba).
  // Respuesta idempotente: devolvemos el estado ACTUAL sin efectos secundarios.
  if (!updated) {
    if (isStatusTransition) {
      const { data: current } = await admin
        .from('tasks')
        .select(taskSelect)
        .eq('id', params.taskId)
        .maybeSingle() as { data: TaskUpdateResult | null; error: unknown }
      if (!current) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })
      return NextResponse.json({ ...current, spawned_task_id: null })
    }
    return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })
  }

  // Coalesced: ajustar tres campos seguidos de la misma tarea es una sola
  // edicion desde la vista de quien lee la bitacora.
  logActivityCoalesced({
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

  // Transicion REAL a completado: la categoria previa NO era 'done'. Un proyecto
  // puede tener varios estados 'done' (ej. Completado y Archivado); mover entre
  // ellos cambia status_id pero NO debe volver a clonar la serie (evita doble spawn).
  const enteredDone = updated.status?.category === 'done' && existing.status?.category !== 'done'

  let spawnedTaskId: string | null = null
  if (statusChanged && enteredDone && effectiveRule) {
    // Base = la fecha de vencimiento MAS reciente. Si este mismo PATCH movio el
    // due_date (updated.due_date), esa manda; si no, cae al valor previo; si la
    // tarea no tiene fecha, se ancla en hoy. Antes usaba solo existing.due_date,
    // asi que completar y reagendar en el mismo PATCH clonaba con la fecha vieja.
    const baseSource = updated.due_date ?? existing.due_date
    const baseDate = baseSource ? new Date(baseSource) : new Date()
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
      const { data: spawned, error: spawnError } = await admin
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

          admin.from('notifications').insert({
            workspace_id: existing.workspace_id,
            recipient_id: nextAssignee,
            subject_id: null, // generado por el sistema de recurrencia, no por el actor
            type: NotificationTypes.TASK_RECURRENCE_CREATED,
            object_type: 'task',
            object_id: spawned.id,
            object_title: spawned.title,
          }).then(() => {}, console.error)
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
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
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

  const { ok: canAccess } = await canAccessProject(admin, existing.project_id, user.id)
  if (!canAccess) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Soft delete (archivar)
  const { error: archiveError } = await admin
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

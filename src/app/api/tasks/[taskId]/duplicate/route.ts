/**
 * POST /api/tasks/[taskId]/duplicate, duplica una tarea.
 *
 * Crea una tarea nueva copiando los campos de contenido y planeacion (titulo
 * con "(copia)", descripcion, prioridad, estado, asignado, fechas, estimacion,
 * sprint, story points, area, recurrencia). Queda al final de la MISMA columna
 * de estado, en el mismo proyecto. NO copia comentarios, adjuntos, seguidores
 * ni subtareas (misma decision de UX que duplicar notas: evita sorpresas).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'
import { autoWatch } from '@/lib/watchers'
import { sanitizeRichText } from '@/lib/sanitize'

interface RouteParams {
  params: { taskId: string }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  type Source = {
    project_id: string
    workspace_id: string
    parent_task_id: string | null
    title: string
    description: string | null
    priority: string
    status_id: string | null
    assignee_id: string | null
    due_date: string | null
    start_date: string | null
    estimate_minutes: number | null
    sprint_id: string | null
    story_points: number | null
    area: string | null
    recurrence_rule: string | null
    recurrence_end_date: string | null
  }

  const { data: source } = await admin
    .from('tasks')
    .select('project_id, workspace_id, parent_task_id, title, description, priority, status_id, assignee_id, due_date, start_date, estimate_minutes, sprint_id, story_points, area, recurrence_rule, recurrence_end_date')
    .eq('id', params.taskId)
    .eq('is_archived', false)
    .maybeSingle() as { data: Source | null; error: unknown }

  if (!source) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

  // Acceso: miembro del proyecto de la tarea.
  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', source.project_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // sort_order al final de la misma columna de estado (mismo patron que la
  // recurrencia): se toma el ultimo de esa columna y se genera una clave despues.
  type SortRow = { sort_order: string }
  let lastTaskQuery = admin
    .from('tasks')
    .select('sort_order')
    .eq('project_id', source.project_id)
    .order('sort_order', { ascending: false })
    .limit(1)
  lastTaskQuery = source.status_id
    ? lastTaskQuery.eq('status_id', source.status_id)
    : lastTaskQuery.is('status_id', null)
  const { data: lastTask } = await lastTaskQuery.maybeSingle() as { data: SortRow | null; error: unknown }

  const { generateKeyBetween } = await import('fractional-indexing')
  const sortOrder = generateKeyBetween(lastTask?.sort_order ?? null, null)

  type TaskResult = { id: string; title: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: copy, error } = await (admin as any)
    .from('tasks')
    .insert({
      project_id:          source.project_id,
      workspace_id:        source.workspace_id,
      parent_task_id:      source.parent_task_id,
      title:               `${source.title} (copia)`,
      // Saneado defensivo al copiar: el origen pudo escribirse antes de S21.
      description:         source.description == null ? null : sanitizeRichText(source.description),
      priority:            source.priority,
      status_id:           source.status_id,
      assignee_id:         source.assignee_id,
      due_date:            source.due_date,
      start_date:          source.start_date,
      estimate_minutes:    source.estimate_minutes,
      sprint_id:           source.sprint_id,
      story_points:        source.story_points,
      area:                source.area,
      recurrence_rule:     source.recurrence_rule,
      recurrence_end_date: source.recurrence_end_date,
      sort_order:          sortOrder,
      created_by:          user.id,
    })
    .select('id, title')
    .single() as { data: TaskResult | null; error: unknown }

  if (error || !copy) {
    console.error('[tasks duplicate POST] insert error:', error)
    return NextResponse.json({
      error: 'Error al duplicar',    }, { status: 500 })
  }

  // Quien duplica pasa a seguir la copia (best effort).
  autoWatch(admin, copy.id, source.project_id, user.id).catch(console.error)

  logActivity({
    verb: ActivityVerbs.TASK_CREATED,
    subject_id: user.id,
    object_type: 'task',
    object_id: copy.id,
    object_title: copy.title,
    workspace_id: source.workspace_id,
    project_id: source.project_id,
    metadata: { duplicated_from: params.taskId },
  }).catch(console.error)

  return NextResponse.json(copy, { status: 201 })
}

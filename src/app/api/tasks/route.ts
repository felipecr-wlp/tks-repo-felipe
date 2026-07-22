/**
 * POST /api/tasks, Crea una nueva tarea en un proyecto.
 *
 * Body: { project_id, title, status_id?, priority?, assignee_id?, due_date? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, notify, ActivityVerbs, NotificationTypes } from '@/lib/activity'
import { autoWatch } from '@/lib/watchers'
import { runAutomations } from '@/lib/automations'

const createSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(500).trim(),
  status_id: z.string().uuid().optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional().default('none'),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date: z.string().datetime().nullable().optional(),
  parent_task_id: z.string().uuid().nullable().optional(),
  // Plantilla de tarea opcional: si viene, tras crear la tarea se prellenan los
  // campos que el usuario no envio y se siembra la checklist de la plantilla.
  template_id: z.string().uuid().optional(),
})

export async function POST(request: NextRequest) {
  // Rate limit
  const limited = await applyRateLimit(request)
  if (limited) return limited

  // Auth
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  // Validar body
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { project_id, title, status_id, priority, assignee_id, due_date, parent_task_id, template_id } = parsed.data

  const admin = createAdminClient()

  // Verificar acceso al proyecto (admin client bypass RLS)
  const { data: membership, error: membershipErr } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', project_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  // Distinguir fallo de lectura (500) de ausencia real de membresia (403).
  if (membershipErr) {
    console.error('[tasks POST] membership read error:', membershipErr)
    return NextResponse.json({ error: 'Error al verificar acceso' }, { status: 500 })
  }
  if (!membership) return NextResponse.json({ error: 'Sin acceso al proyecto' }, { status: 403 })

  // Obtener workspace_id del proyecto (para denormalización)
  type ProjRow = { workspace_id: string; team_id: string }
  const { data: project } = await admin
    .from('projects')
    .select('workspace_id, team_id')
    .eq('id', project_id)
    .maybeSingle() as { data: ProjRow | null; error: unknown }

  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })

  // Si es subtarea, verificar que el padre exista y pertenezca al mismo proyecto
  // (anti cross-proyecto). Solo un nivel de anidación: el padre no puede ser subtarea.
  if (parent_task_id) {
    type ParentRow = { id: string; parent_task_id: string | null }
    const { data: parent } = await admin
      .from('tasks')
      .select('id, parent_task_id')
      .eq('id', parent_task_id)
      .eq('project_id', project_id)
      .maybeSingle() as { data: ParentRow | null; error: unknown }

    if (!parent) return NextResponse.json({ error: 'Tarea padre no encontrada' }, { status: 404 })
    if (parent.parent_task_id) {
      return NextResponse.json({ error: 'No se permite anidar subtareas' }, { status: 422 })
    }
  }

  // Si no se especifica status, tomar el primero del proyecto (posición 0)
  let resolvedStatusId = status_id
  if (!resolvedStatusId) {
    type StatusRow = { id: string }
    const { data: firstStatus } = await admin
      .from('task_statuses')
      .select('id')
      .eq('project_id', project_id)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle() as { data: StatusRow | null; error: unknown }

    resolvedStatusId = firstStatus?.id
  }

  // Calcular sort_order (fractal indexing, posición al final del grupo)
  type SortRow = { sort_order: string }
  let lastTaskQuery = admin
    .from('tasks')
    .select('sort_order')
    .eq('project_id', project_id)
    .order('sort_order', { ascending: false })
    .limit(1)

  if (resolvedStatusId) {
    lastTaskQuery = lastTaskQuery.eq('status_id', resolvedStatusId)
  } else {
    lastTaskQuery = lastTaskQuery.is('status_id', null)
  }

  const { data: lastTask } = await lastTaskQuery.maybeSingle() as { data: SortRow | null; error: unknown }

  const { generateKeyBetween } = await import('fractional-indexing')
  const sortOrder = generateKeyBetween(lastTask?.sort_order ?? null, null)

  // Crear la tarea
  type TaskInsertResult = {
    id: string
    title: string
    priority: string
    due_date: string | null
    sort_order: string
    status: { id: string; name: string; color: string | null; category: string } | null
    assignee: { id: string; display_name: string; avatar_url: string | null } | null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any
  const { data: newTask, error: insertError } = await db
    .from('tasks')
    .insert({
      project_id,
      workspace_id: project.workspace_id,
      title,
      status_id: resolvedStatusId ?? null,
      priority,
      assignee_id: assignee_id ?? null,
      due_date: due_date ?? null,
      parent_task_id: parent_task_id ?? null,
      sort_order: sortOrder,
      created_by: user.id,
    })
    .select(`
      id, title, priority, due_date, sort_order,
      status:task_statuses ( id, name, color, category ),
      assignee:profiles!tasks_assignee_id_fkey ( id, display_name, avatar_url )
    `)
    .single() as { data: TaskInsertResult | null; error: unknown }

  if (insertError || !newTask) {
    console.error('[tasks POST] insert error:', insertError)
    return NextResponse.json({
      error: 'Error al crear la tarea',    }, { status: 500 })
  }

  // ── Sembrado desde plantilla (opcional) ──────────────────────────────────
  // Si se indico template_id: se cargan los campos de la plantilla y se rellenan
  // los que el usuario NO envio (nunca se pisa lo que el usuario tecleo), y se
  // insertan los items de checklist. Se ESPERA (await) para que la tarea nazca
  // completa antes de responder, pero envuelto en try/catch: un fallo del
  // sembrado se registra y no rompe la creacion (igual devolvemos 201).
  if (template_id) {
    try {
      type TemplateRow = {
        workspace_id: string
        project_id: string | null
        description: string | null
        priority: string
        estimate_minutes: number | null
        story_points: number | null
        checklist: Array<{ text?: string }> | null
      }
      const { data: template } = await admin
        .from('task_templates')
        .select('workspace_id, project_id, description, priority, estimate_minutes, story_points, checklist')
        .eq('id', template_id)
        .maybeSingle() as { data: TemplateRow | null; error: unknown }

      // La plantilla debe ser del mismo workspace y visible para este proyecto
      // (propia del proyecto o de todo el workspace). Nunca cross-workspace.
      const visible =
        !!template &&
        template.workspace_id === project.workspace_id &&
        (template.project_id === null || template.project_id === project_id)

      if (visible && template) {
        // El body crudo dice si el usuario suministro cada campo (no lo pisamos).
        const raw = (body ?? {}) as Record<string, unknown>
        const patch: Record<string, unknown> = {}

        // La descripcion no esta en createSchema, asi que el usuario nunca la
        // manda aqui: si la plantilla la trae, se aplica.
        if (template.description != null && raw.description === undefined) {
          patch.description = template.description
        }
        // priority: solo si el usuario NO lo envio explicitamente.
        if (raw.priority === undefined && template.priority) {
          patch.priority = template.priority
        }
        if (raw.estimate_minutes === undefined && template.estimate_minutes != null) {
          patch.estimate_minutes = template.estimate_minutes
        }
        if (raw.story_points === undefined && template.story_points != null) {
          patch.story_points = template.story_points
        }

        if (Object.keys(patch).length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await (admin as any).from('tasks').update(patch).eq('id', newTask.id)
        }

        // Sembrar la checklist: se crea una checklist default y sus items.
        const items = (template.checklist ?? [])
          .map(i => (typeof i?.text === 'string' ? i.text.trim() : ''))
          .filter(Boolean)

        if (items.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: checklist } = await (admin as any)
            .from('task_checklists')
            .insert({ task_id: newTask.id, title: 'Subtareas', position: 0 })
            .select('id')
            .single() as { data: { id: string } | null; error: unknown }

          if (checklist) {
            const rows = items.map((title, position) => ({
              checklist_id: checklist.id,
              task_id: newTask.id,
              title,
              position,
            }))
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await (admin as any).from('task_checklist_items').insert(rows)
          }
        }
      }
    } catch (seedErr) {
      // No debe romper la creacion de la tarea.
      console.error('[tasks POST] template seed error:', seedErr)
    }
  }

  // Log actividad (async, no bloquea)
  logActivity({
    verb: ActivityVerbs.TASK_CREATED,
    subject_id: user.id,
    object_type: 'task',
    object_id: newTask.id,
    object_title: newTask.title,
    workspace_id: project.workspace_id,
    project_id,
  }).catch(console.error)

  // Auto-seguimiento: el creador (y el asignado inicial, si lo hay) siguen la
  // tarea para recibir notificaciones de cambios futuros (best effort).
  autoWatch(admin, newTask.id, project_id, user.id).catch(console.error)
  if (assignee_id && assignee_id !== user.id) {
    autoWatch(admin, newTask.id, project_id, assignee_id).catch(console.error)
    // Avisar al asignado inicial (Bandeja + correo opt-out). Circuito 2.A.
    notify({
      recipient_id: assignee_id,
      subject_id:   user.id,
      type:         NotificationTypes.TASK_ASSIGNED,
      object_type:  'task',
      object_id:    newTask.id,
      object_title: newTask.title,
      workspace_id: project.workspace_id,
    }).catch(console.error)
  }

  // ── Automatizaciones (Circuito 3.B): disparador "se crea tarea" ───────────
  // Corre las reglas activas del proyecto con trigger task_created. Best effort,
  // no re-entra al motor (las acciones escriben directo). No bloquea la respuesta.
  runAutomations({
    admin,
    event: 'task_created',
    actorId: user.id,
    task: {
      id: newTask.id,
      project_id,
      workspace_id: project.workspace_id,
      title: newTask.title,
      status_id: resolvedStatusId ?? null,
      assignee_id: assignee_id ?? null,
      priority,
      due_date: due_date ?? null,
    },
  }).catch(console.error)

  return NextResponse.json(newTask, { status: 201 })
}

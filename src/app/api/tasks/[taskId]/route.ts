/**
 * GET    /api/tasks/[taskId], Detalle completo de una tarea
 * PATCH  /api/tasks/[taskId], Actualiza campos de una tarea
 * DELETE /api/tasks/[taskId], Archiva una tarea (soft delete)
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'

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
    due_date: string | null; sort_order: string; created_at: string; updated_at: string
    project_id: string
    status: { id: string; name: string; color: string | null; category: string } | null
    assignee: { id: string; display_name: string; avatar_url: string | null } | null
    created_by_profile: { id: string; display_name: string; avatar_url: string | null } | null
    parent: { id: string; title: string } | null
  }
  const { data: task } = await admin
    .from('tasks')
    .select(`
      id, title, description, priority, due_date, sort_order, created_at, updated_at, project_id,
      status:task_statuses ( id, name, color, category ),
      assignee:profiles!tasks_assignee_id_fkey ( id, display_name, avatar_url ),
      created_by_profile:profiles!tasks_created_by_fkey ( id, display_name, avatar_url ),
      parent:tasks!tasks_parent_task_id_fkey ( id, title )
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
  sort_order:  z.string().optional(),
  // ── Capa SCRUM ──────────────────────────────────────────────
  sprint_id:         z.string().uuid().nullable().optional(),
  story_points:      z.number().refine(n => (SP_VALUES as readonly number[]).includes(n), 'Fibonacci 1,2,3,5,8,13,21').nullable().optional(),
  story_points_done: z.number().refine(n => (SP_VALUES as readonly number[]).includes(n), 'Fibonacci 1,2,3,5,8,13,21').nullable().optional(),
  area:              z.string().max(60).nullable().optional(),
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

  type TaskUpdateResult = {
    id: string
    title: string
    description: string | null
    priority: string
    due_date: string | null
    sort_order: string
    created_at: string
    updated_at: string
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
      id, title, description, priority, due_date, sort_order, created_at, updated_at,
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

  return NextResponse.json(updated)
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

/**
 * GET    /api/goals/[goalId]/tasks              lista tareas enlazadas a la meta
 * POST   /api/goals/[goalId]/tasks  { task_id }  enlaza una tarea
 * DELETE /api/goals/[goalId]/tasks?taskId=...    quita el enlace
 *
 * Seguridad: la meta debe estar en un workspace del usuario. La tarea enlazada
 * debe pertenecer a un proyecto de ESE workspace (anti-IDOR cross-workspace).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { goalId: string }
}

const postSchema = z.object({ task_id: z.string().uuid() })

type LinkedTask = {
  id: string
  title: string
  status: { id: string; name: string; color: string | null; category: string } | null
}

// ── Helper: la meta existe, devuelve su workspace y valida acceso ────────────
async function goalWorkspace(
  admin: ReturnType<typeof createAdminClient>,
  goalId: string,
  userId: string,
): Promise<{ ok: boolean; status: number; workspaceId: string | null }> {
  const { data: goal } = await admin
    .from('goals')
    .select('workspace_id')
    .eq('id', goalId)
    .maybeSingle() as { data: { workspace_id: string } | null }
  if (!goal) return { ok: false, status: 404, workspaceId: null }

  const { data: member } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', goal.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle()
  if (member) return { ok: true, status: 200, workspaceId: goal.workspace_id }

  const { data: profile } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle() as { data: { org_role: string | null } | null }
  if (profile?.org_role === 'owner' || profile?.org_role === 'admin') {
    return { ok: true, status: 200, workspaceId: goal.workspace_id }
  }
  return { ok: false, status: 403, workspaceId: null }
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.goalId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const access = await goalWorkspace(admin, params.goalId, user.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 404 ? 'Meta no encontrada' : 'Sin acceso' }, { status: access.status })
  }

  type Row = { id: string; task: LinkedTask | null }
  const { data } = await admin
    .from('goal_tasks')
    .select('id, task:tasks ( id, title, status:task_statuses ( id, name, color, category ) )')
    .eq('goal_id', params.goalId) as { data: Row[] | null }

  const tasks = (data ?? [])
    .filter(r => r.task)
    .map(r => ({ linkId: r.id, ...(r.task as LinkedTask) }))

  return NextResponse.json({ tasks })
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.goalId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos invalidos' }, { status: 422 })

  const admin = createAdminClient()
  const access = await goalWorkspace(admin, params.goalId, user.id)
  if (!access.ok || !access.workspaceId) {
    return NextResponse.json({ error: access.status === 404 ? 'Meta no encontrada' : 'Sin acceso' }, { status: access.status })
  }

  // la tarea debe pertenecer a un proyecto del MISMO workspace (anti-IDOR)
  type TaskRow = LinkedTask & { project: { workspace_id: string } | null }
  const { data: task } = await admin
    .from('tasks')
    .select('id, title, status:task_statuses ( id, name, color, category ), project:projects ( workspace_id )')
    .eq('id', parsed.data.task_id)
    .maybeSingle() as { data: TaskRow | null }
  if (!task || task.project?.workspace_id !== access.workspaceId) {
    return NextResponse.json({ error: 'Tarea no encontrada en este workspace' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: link, error } = await (admin as any)
    .from('goal_tasks')
    .upsert({ goal_id: params.goalId, task_id: parsed.data.task_id }, { onConflict: 'goal_id,task_id', ignoreDuplicates: false })
    .select('id')
    .single()

  if (error) {
    console.error('[goal tasks POST] error:', error)
    return NextResponse.json({ error: 'Error al enlazar la tarea' }, { status: 500 })
  }

  return NextResponse.json({
    task: { linkId: link.id, id: task.id, title: task.title, status: task.status },
  }, { status: 201 })
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.goalId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const taskId = request.nextUrl.searchParams.get('taskId')
  if (!taskId) return NextResponse.json({ error: 'Falta taskId' }, { status: 400 })

  const admin = createAdminClient()
  const access = await goalWorkspace(admin, params.goalId, user.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 404 ? 'Meta no encontrada' : 'Sin acceso' }, { status: access.status })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('goal_tasks')
    .delete()
    .eq('goal_id', params.goalId)
    .eq('task_id', taskId)
  if (error) {
    console.error('[goal tasks DELETE] error:', error)
    return NextResponse.json({ error: 'Error al quitar la tarea' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

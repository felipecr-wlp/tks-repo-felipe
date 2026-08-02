/**
 * GET /api/tasks/[taskId]/subtasks, lista las subtareas (hijos directos) de una
 * tarea, con su estado y categoría para poder calcular el avance (hechas/total).
 *
 * La creación de subtareas reutiliza POST /api/tasks con `parent_task_id`, y el
 * cambio de estado reutiliza PATCH /api/tasks/[taskId]; este endpoint es solo de
 * lectura. El project_id/workspace_id se derivan en el servidor (anti-IDOR): el
 * cliente solo envía el taskId.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { checkTaskAccess } from '@/lib/task-access'

interface RouteParams {
  params: { taskId: string }
}

type SubtaskRow = {
  id: string
  title: string
  priority: string
  due_date: string | null
  status: { id: string; name: string; color: string | null; category: string } | null
  assignee: { id: string; display_name: string; avatar_url: string | null } | null
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    )
  }

  const { data: subtasks, error: subtasksError } = await admin
    .from('tasks')
    .select(`
      id, title, priority, due_date,
      status:task_statuses ( id, name, color, category ),
      assignee:profiles!tasks_assignee_id_fkey ( id, display_name, avatar_url )
    `)
    .eq('parent_task_id', params.taskId)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true }) as { data: SubtaskRow[] | null; error: unknown }

  if (subtasksError) {
    console.error('[subtasks GET] read error:', subtasksError)
    return NextResponse.json({ error: 'Error al cargar subtareas' }, { status: 500 })
  }

  return NextResponse.json({ subtasks: subtasks ?? [] })
}

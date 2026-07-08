/**
 * Helper de autorización para subrecursos de una tarea (checklist, etc.).
 *
 * Las rutas de checklist usan el admin client (que ignora RLS), así que la
 * pertenencia se DEBE verificar en el handler. Sin esto, cualquier usuario
 * autenticado podría leer o mutar la checklist de una tarea de otro workspace
 * con solo adivinar el taskId (IDOR). Misma verificación que ya usa
 * /api/tasks/[taskId]/comments.
 */
import type { createAdminClient } from '@/lib/supabase/server'

interface TaskAccess {
  ok: boolean
  status: number
  projectId: string | null
}

export async function checkTaskAccess(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
  userId: string,
): Promise<TaskAccess> {
  type TaskCheck = { project_id: string }
  const { data: task } = await admin
    .from('tasks')
    .select('project_id')
    .eq('id', taskId)
    .maybeSingle() as { data: TaskCheck | null; error: unknown }

  if (!task) return { ok: false, status: 404, projectId: null }

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', task.project_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return { ok: false, status: 403, projectId: task.project_id }

  return { ok: true, status: 200, projectId: task.project_id }
}

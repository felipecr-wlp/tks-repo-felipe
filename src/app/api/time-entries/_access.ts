/**
 * Helpers de acceso para time tracking. Prefijo "_" => Next.js NO lo enruta.
 *
 * Anti-IDOR: toda entrada de tiempo cuelga de una tarea; el usuario debe ser
 * miembro del proyecto de esa tarea. Se resuelve project_id + workspace_id desde
 * la tarea (no se confia en lo que mande el cliente).
 */
import { createAdminClient } from '@/lib/supabase/server'

export type TaskAccess = { project_id: string; workspace_id: string }

/**
 * Verifica que la tarea exista y que el usuario sea miembro de su proyecto.
 * Devuelve { project_id, workspace_id } o null si no hay tarea/acceso.
 */
export async function resolveTaskAccess(taskId: string, userId: string): Promise<TaskAccess | null> {
  const admin = createAdminClient()

  const { data: task } = await admin
    .from('tasks')
    .select('id, project_id, workspace_id')
    .eq('id', taskId)
    .maybeSingle() as { data: { id: string; project_id: string; workspace_id: string } | null }
  if (!task) return null

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', task.project_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null }
  if (!membership) return null

  return { project_id: task.project_id, workspace_id: task.workspace_id }
}

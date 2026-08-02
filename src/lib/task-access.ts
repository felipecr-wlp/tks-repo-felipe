/**
 * Helper de autorización para subrecursos de una tarea (checklist, asignados,
 * watchers, labels, dependencias, etc.).
 *
 * Las rutas de subrecursos usan el admin client (que ignora RLS), así que la
 * pertenencia se DEBE verificar en el handler. Sin esto, cualquier usuario
 * autenticado podría leer o mutar la checklist de una tarea de otro workspace
 * con solo adivinar el taskId (IDOR).
 *
 * La regla de acceso se DELEGA a `canAccessProject` (team-access) para que sea
 * IDENTICA a la de GET/PATCH/DELETE de la tarea y de comments: miembro del
 * proyecto (cualquier rol) O owner/admin del workspace/org (supervisión). Antes
 * este helper solo miraba `project_members`, así que un admin de workspace abría
 * la tarea (200) pero recibía 403 al tocar sus subtareas/checklist/asignados.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import { canAccessProject, ERROR_ACCESO_INDETERMINADO } from '@/lib/team-access'

interface TaskAccess {
  ok: boolean
  status: number
  projectId: string | null
  /**
   * El mensaje que le corresponde al `status`. Vive AQUI y no en cada ruta porque
   * las 10 rutas de subrecursos repetian el mismo ternario
   * (`status === 404 ? 'Tarea no encontrada' : 'Sin acceso'`), 21 veces. Ese
   * ternario solo conocia dos mundos, asi que al aparecer un tercer status (500)
   * lo habria etiquetado "Sin acceso": el codigo correcto con el texto mentiroso,
   * que es justo la confusion que este cambio viene a quitar. Quien decide el
   * status decide el mensaje.
   */
  error: string
}

export async function checkTaskAccess(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
  userId: string,
): Promise<TaskAccess> {
  type TaskCheck = { project_id: string }
  // Capturar `error` (no solo `data`): si la lectura falla de verdad, devolver
  // 500 en vez de disfrazarlo como 404 "no encontrado" (landmine del proyecto).
  const { data: task, error: taskErr } = await admin
    .from('tasks')
    .select('project_id')
    .eq('id', taskId)
    .maybeSingle() as { data: TaskCheck | null; error: unknown }

  if (taskErr) {
    console.error('[checkTaskAccess] task read error:', taskErr)
    return { ok: false, status: 500, projectId: null, error: ERROR_ACCESO_INDETERMINADO }
  }
  if (!task) return { ok: false, status: 404, projectId: null, error: 'Tarea no encontrada' }

  // La misma distincion que arriba, pero para el acceso: `canAccessProject`
  // devuelve `failed` cuando NO pudo determinar el acceso (una lectura fallo),
  // que no es lo mismo que determinar que no lo tiene. Este helper ya sabia
  // separar 500 de 404 para la tarea y perdia esa separacion justo despues, en
  // el paso que mas importa. Un 403 aqui manda al usuario a pedir permisos que
  // ya tiene mientras la causa real (la base) no aparece por ningun lado.
  const { ok, failed } = await canAccessProject(admin, task.project_id, userId)
  if (failed) {
    return { ok: false, status: 500, projectId: task.project_id, error: ERROR_ACCESO_INDETERMINADO }
  }
  if (!ok) return { ok: false, status: 403, projectId: task.project_id, error: 'Sin acceso' }

  return { ok: true, status: 200, projectId: task.project_id, error: '' }
}

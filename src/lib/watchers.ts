/**
 * Auto-seguimiento (auto-watch). Circuito B11.
 *
 * En ClickUp/Linear, interactuar con una tarea (comentar, ser asignado, crearla)
 * te vuelve seguidor automaticamente, para que recibas notificaciones de cambios
 * futuros sin tener que dar "Seguir" a mano. Esta helper inserta en task_watchers
 * ignorando duplicados (UNIQUE task_id+profile_id), asi que es idempotente y
 * segura de llamar en cada interaccion.
 *
 * Best effort: nunca debe romper el flujo principal (comentar, asignar, crear).
 * Por eso captura sus propios errores y no lanza. Usa el admin client que ya
 * trae el handler (la autorizacion se verifico antes por membresia de proyecto).
 */
import type { createAdminClient } from '@/lib/supabase/server'

export async function autoWatch(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
  projectId: string,
  profileId: string,
): Promise<void> {
  try {
    await admin
      .from('task_watchers')
      .upsert(
        { task_id: taskId, project_id: projectId, profile_id: profileId },
        { onConflict: 'task_id,profile_id', ignoreDuplicates: true },
      )
  } catch (error) {
    console.error('[autoWatch] Error:', error)
  }
}

/**
 * Constantes compartidas de los ADJUNTOS DE TAREA (bucket privado `task-files`).
 *
 * Por que vive aqui y no en el route.ts: un `route.ts` de App Router solo puede
 * exportar handlers y config, asi que cualquier constante que necesiten dos
 * rutas (la de subida directa y la de registro) tiene que salir a lib.
 *
 * ── Limite real de tamaño y por que hay DOS numeros ────────────────────────
 * En Vercel el cuerpo de una request a una serverless function esta acotado a
 * ~4.5MB. Toda subida que pase el archivo POR la API (multipart/form-data) muere
 * ahi con un 413 que la app ni siquiera controla, sin importar lo que diga el
 * limite de la aplicacion. Por eso:
 *
 *   DIRECT_MAX_SIZE  tope del camino viejo (multipart por la API). Se queda
 *                    debajo del techo de Vercel para fallar con un mensaje
 *                    claro nuestro en vez de un 413 opaco de la plataforma.
 *   MAX_SIZE         tope real del archivo. Solo alcanzable por el camino de
 *                    signed upload URL, donde el binario viaja del navegador
 *                    DIRECTO a Supabase Storage y nunca toca la funcion.
 *
 * El video de campaña (Meta, TikTok, YouTube) solo entra por el segundo camino.
 */

/** Tope real de un adjunto. Requiere subida directa a storage. */
export const TASK_FILES_MAX_SIZE = 200 * 1024 * 1024 // 200MB

/** Tope del camino multipart legacy, por debajo del techo de body de Vercel. */
export const TASK_FILES_DIRECT_MAX_SIZE = 4 * 1024 * 1024 // 4MB

export const TASK_FILES_BUCKET = 'task-files'

/**
 * Tipos permitidos. Incluye video porque el equipo de paid media trabaja con
 * creativos en video; sin esto un MP4 de Meta o TikTok no se puede adjuntar.
 *
 * Nota sobre image/svg+xml: se conserva porque los logos de marca llegan en SVG,
 * y un SVG puede llevar script. Se sirve siempre desde el bucket PRIVADO por
 * signed URL (origen distinto al de la app), asi que no corre en el origen de
 * WLO. No agregar SVG a ningun bucket publico.
 */
export const TASK_FILES_MIME_ALLOWLIST = new Set([
  // Imagen
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'image/avif',
  // Video (creativos de campaña)
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
  // Audio (locuciones, podcast)
  'audio/mpeg', 'audio/wav', 'audio/mp4',
  // Documentos
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
])

/** Limpia el nombre de archivo: sin traversal, sin separadores, acotado. */
export function safeFileName(raw: string | null | undefined): string {
  return (raw || 'archivo').replace(/[^\w.\-]+/g, '_').slice(0, 120)
}

/**
 * Path canonico de un adjunto. TODO objeto de una tarea vive bajo
 * `task/<taskId>/`, y ese prefijo es lo que se valida al registrar un archivo
 * subido por signed URL: sin el, un cliente podria reclamar como propio un
 * objeto de OTRA tarea pasando su path.
 */
export function taskFilePrefix(taskId: string): string {
  return `task/${taskId}/`
}

/**
 * Primitiva de autorizacion de los adjuntos: resuelve la tarea y exige que el
 * usuario sea miembro de SU proyecto. Compartida por la ruta de registro y la
 * de signed upload URL para que las dos apliquen exactamente el mismo candado.
 *
 * `import type` del admin client: es solo tipo, se borra al compilar, asi que
 * este modulo sigue siendo importable desde el cliente para las constantes.
 */
import type { createAdminClient } from '@/lib/supabase/server'

export interface TaskFileScope { project_id: string; workspace_id: string }

export async function loadTaskWithAccess(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string,
  userId: string,
): Promise<{ task: TaskFileScope | null; isMember: boolean }> {
  const { data: task } = await admin
    .from('tasks')
    .select('project_id, workspace_id')
    .eq('id', taskId)
    .maybeSingle() as { data: TaskFileScope | null; error: unknown }
  if (!task) return { task: null, isMember: false }

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', task.project_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  return { task, isMember: !!membership }
}

/**
 * Constantes compartidas del bucket chat-files (adjuntos del chat de equipo).
 * Vive fuera de los route handlers porque un archivo de ruta de Next solo puede
 * exportar los verbos HTTP; exportar otra cosa rompe el build.
 */
export const CHAT_FILES_BUCKET = 'chat-files'
export const CHAT_FILES_MAX_SIZE = 25 * 1024 * 1024 // 25MB

export const CHAT_FILES_MIME_ALLOWLIST = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml',
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

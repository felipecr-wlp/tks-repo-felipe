-- ─────────────────────────────────────────────────────────────────────────────
-- Track 1, Circuito 1.B: bucket privado para adjuntos del chat de EQUIPO.
-- Se sirve solo con signed URL temporal generada por el admin client; el control
-- de acceso real vive en la capa API (canAccessTeamById + validacion de prefijo
-- team/<id>/). Aditivo: no toca task-files ni ninguna tabla existente.
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-files',
  'chat-files',
  false,
  26214400, -- 25MB
  ARRAY[
    'image/png','image/jpeg','image/gif','image/webp','image/svg+xml',
    'application/pdf',
    'text/plain','text/csv','text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]
) ON CONFLICT (id) DO NOTHING;

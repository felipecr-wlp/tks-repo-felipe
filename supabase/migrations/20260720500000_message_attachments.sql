-- ─────────────────────────────────────────────────────────────────────────────
-- Track 1, Circuito 1.A: adjuntos en el chat de equipo (tarjetas de tarea).
-- Aditivo y con default. NO crea tablas, NO toca FKs ni RLS existentes, por lo
-- que es inmune a los landmines de ciclos de FK y recursion de policies.
--
-- El adjunto se guarda como referencia minima en jsonb, p. ej.:
--   [{ "type": "task", "task_id": "<uuid>" }]
-- El servidor valida en el POST que cada tarea pertenezca al equipo antes de
-- guardarla, y el cliente resuelve la tarjeta viva (titulo, estado, prioridad,
-- asignado) al render. Asi el chip siempre refleja el estado actual de la tarea.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

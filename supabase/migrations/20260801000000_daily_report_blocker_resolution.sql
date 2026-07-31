-- Cerrar el ciclo del bloqueo.
--
-- Desde la v3 un bloqueo avisa a los responsables del equipo, pero no habia
-- forma de decir que ya se resolvio. Un aviso que nunca se cierra se convierte
-- en ruido: el lunes siguiente el mando ve seis bloqueos, cinco ya resueltos, y
-- deja de abrirlos. Eso mata la unica alerta util del modulo.
--
-- Se resuelve con UNA columna en la entrada, no con una tabla de estados: un
-- bloqueo solo tiene dos momentos (abierto y resuelto) y la fecha en que se
-- resolvio es toda la historia que hace falta. NULL = sigue abierto.
--
-- La columna vive en daily_report_entries y no en daily_reports porque lo que
-- se desbloquea es una cosa concreta, no el dia entero.

ALTER TABLE daily_report_entries
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- El indice solo cubre los bloqueos abiertos, que son los unicos que se
-- consultan. Indexar la tabla entera para una minoria de filas seria pagar
-- escritura en cada actividad registrada a cambio de nada.
CREATE INDEX IF NOT EXISTS idx_daily_report_entries_bloqueo_abierto
  ON daily_report_entries(report_id)
  WHERE category = 'bloqueo' AND resolved_at IS NULL;

COMMENT ON COLUMN daily_report_entries.resolved_at IS
  'Cuando se desbloqueo. Solo tiene sentido si category = bloqueo. NULL = sigue detenido.';

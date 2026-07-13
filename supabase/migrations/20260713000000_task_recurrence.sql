-- ─── Circuito B26: tareas recurrentes ──────────────────────────────────────
-- Agrega recurrencia opcional a una tarea. Al completarla (status category
-- 'done') con recurrence_rule activo, la API clona la tarea con la fecha de
-- vencimiento avanzada segun la regla, hasta recurrence_end_date si existe.
-- Aditivo, sin tocar filas existentes (ambas columnas nullable, default NULL).

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS recurrence_rule text
    CHECK (recurrence_rule IN ('daily','weekly','biweekly','monthly')),
  ADD COLUMN IF NOT EXISTS recurrence_end_date timestamptz;

-- Indice parcial: solo tareas con recurrencia activa (barrido futuro si se
-- necesita un cron de reconciliacion; hoy el spawn es sincrono en el PATCH).
CREATE INDEX IF NOT EXISTS idx_tasks_recurrence_rule
  ON tasks(id) WHERE recurrence_rule IS NOT NULL;

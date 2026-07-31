-- ─────────────────────────────────────────────────────────────────────────────
-- BITACORA v3: la actividad del dia se amarra a la tarea que ya existe.
--
-- ── El problema ──────────────────────────────────────────────────────────────
-- Hoy el reporte diario y el tablero de tareas son dos memorias separadas que no
-- se hablan. La persona cierra una tarea en el tablero y luego tiene que volver
-- a contar, con otras palabras, que la cerro. Esa segunda narracion es trabajo
-- duplicado, y el trabajo duplicado es exactamente lo que la gente deja de hacer
-- a la semana tres. Los datos lo confirman: el reporte se llena solo por
-- conversacion, y siempre en la misma categoria.
--
-- Con este vinculo el flujo se invierte. BITACORA puede leer lo que la persona
-- YA cerro hoy en el tablero y PROPONER el dia ("cerraste tres tareas, ¿lo
-- registro asi?") en vez de pedirle que narre desde cero. El reporte pasa de ser
-- un formulario a ser una confirmacion.
--
-- ── Por que una sola columna y no una tabla puente ───────────────────────────
-- Una actividad habla de UNA tarea o de ninguna. Una tabla puente resolveria un
-- "muchos a muchos" que aqui no existe, y a cambio pediria un join extra en la
-- consulta mas caliente de la pantalla.
--
-- ── Landmine PostgREST evitada ───────────────────────────────────────────────
-- Hoy NO existe ninguna relacion entre daily_report_entries y tasks. Esta FK
-- crea el PRIMER y UNICO camino entre ambas, asi que los embeds siguen siendo
-- inequivocos. Si alguna vez se agrega otra (por ejemplo un task_id tambien en
-- daily_reports), PostgREST empezaria a responder HTTP 300 en todo embed que las
-- toque: es el mismo error que ya se documento con daily_report_images.
--
-- ── Por que ON DELETE SET NULL y no CASCADE ──────────────────────────────────
-- Borrar la tarea no puede borrar el registro historico de que ese trabajo se
-- hizo. El reporte diario es una bitacora, y una bitacora que se reescribe sola
-- cuando alguien limpia el tablero no sirve como evidencia. Se pierde el enlace,
-- se conserva el hecho.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE daily_report_entries
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES tasks(id) ON DELETE SET NULL;

-- Parcial: la enorme mayoria de las actividades no viene de una tarea, y no
-- tiene sentido indexar miles de NULL para responder "¿que se reporto de esta
-- tarea?".
CREATE INDEX IF NOT EXISTS idx_daily_report_entries_task
  ON daily_report_entries(task_id)
  WHERE task_id IS NOT NULL;

COMMENT ON COLUMN daily_report_entries.task_id IS
  'Tarea del tablero de la que habla esta actividad, si la hay. SET NULL al borrar la tarea: se pierde el enlace, no el registro de que el trabajo ocurrio.';

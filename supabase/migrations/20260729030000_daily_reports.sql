-- ─────────────────────────────────────────────────────────────────────────────
-- REPORTE DIARIO DE ACTIVIDADES.
--
-- Hoy varias personas escriben su reporte del dia por fuera (chat suelto, un
-- documento propio, un agente aparte) y no queda historial consultable: nadie
-- puede responder "que hizo el equipo el martes" sin ir a pedirlo.
--
-- Modelo de dos tablas a proposito:
--
--   daily_reports          UNA fila por persona y por dia. Es el contenedor: el
--                          resumen del dia y su estado (borrador o entregado).
--   daily_report_entries   CADA cosa que la persona narro, con su hora. El dia
--                          se cuenta a pedazos ("acabo de cerrar X", "me
--                          bloquea Y"), no de un tiron al final. Guardar los
--                          pedazos con su hora permite reconstruir el dia real
--                          y no solo la version editada al cierre.
--
-- Por que fecha y no timestamp para agrupar: el reporte pertenece a un DIA
-- laboral. `report_date` la fija el servidor con la zona horaria del workspace,
-- asi lo que alguien escribe a las 11 de la noche no se va al dia siguiente.
--
-- Seguridad (mismos criterios que workspace_messages):
--  - FK solo a tablas hoja (workspaces, profiles) y de entries a su reporte:
--    un solo camino entre cada par de tablas, sin ciclos -> sin HTTP 300.
--  - RLS con subquery a workspace_members o a daily_reports (otras tablas),
--    nunca a si misma -> sin recursion 42P17.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id   uuid        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  report_date  date        NOT NULL,
  -- Resumen del dia. Lo puede escribir la persona o generarlo KERN a partir de
  -- las entradas; en ambos casos es texto plano (markdown ligero).
  summary      text,
  -- 'draft' mientras el dia sigue abierto, 'submitted' cuando la persona lo da
  -- por cerrado. No se bloquea la edicion despues: un reporte corregido vale
  -- mas que uno congelado con un error.
  status       text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted')),
  submitted_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- Un solo reporte por persona y dia: si vuelve a narrar algo, se agrega al
  -- que ya existe en vez de abrir uno nuevo.
  UNIQUE (workspace_id, profile_id, report_date)
);
ALTER TABLE daily_reports ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS daily_report_entries (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id  uuid        NOT NULL REFERENCES daily_reports(id) ON DELETE CASCADE,
  content    text        NOT NULL,
  -- Que clase de cosa es. Separar avance de bloqueo es lo que hace util el
  -- reporte: un bloqueo sin atender es lo unico que exige accion de alguien mas.
  category   text        NOT NULL DEFAULT 'avance'
               CHECK (category IN ('avance','bloqueo','siguiente','nota')),
  -- Minutos dedicados, opcional. Nadie va a cronometrar todo, pero cuando la
  -- persona lo dice ("le meti dos horas a la landing") se aprovecha.
  minutes    int         CHECK (minutes IS NULL OR (minutes >= 0 AND minutes <= 1440)),
  -- De donde vino: 'kern' (se lo conto al asistente) o 'manual' (lo escribio en
  -- la pantalla). Sirve para saber si el canal por chat de verdad se usa.
  source     text        NOT NULL DEFAULT 'kern' CHECK (source IN ('kern','manual')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE daily_report_entries ENABLE ROW LEVEL SECURITY;

-- El listado natural: un workspace, un rango de dias, lo mas reciente primero.
CREATE INDEX IF NOT EXISTS idx_daily_reports_ws_date
  ON daily_reports(workspace_id, report_date DESC);

-- El historial de una persona ("como viene Alan este mes").
CREATE INDEX IF NOT EXISTS idx_daily_reports_profile_date
  ON daily_reports(profile_id, report_date DESC);

-- Las entradas de un reporte en el orden en que ocurrieron.
CREATE INDEX IF NOT EXISTS idx_daily_report_entries_report
  ON daily_report_entries(report_id, created_at);

-- ── RLS: daily_reports ───────────────────────────────────────────────────────
-- Lectura: cualquier miembro del workspace, o admin/owner de la organizacion.
-- El reporte diario es informacion de coordinacion, no un diario privado: su
-- valor esta en que el equipo sepa en que anda el equipo. Lo delicado (sueldos,
-- evaluaciones) no vive aqui.
CREATE POLICY "dr_select" ON daily_reports FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- Escritura: SOLO sobre el propio reporte. Nadie reporta el dia de otro, ni
-- siquiera un admin: un reporte firmado por quien no lo vivio no sirve de nada.
CREATE POLICY "dr_insert" ON daily_reports FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
  );

CREATE POLICY "dr_update" ON daily_reports FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

CREATE POLICY "dr_delete" ON daily_reports FOR DELETE
  USING (
    profile_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ── RLS: daily_report_entries ────────────────────────────────────────────────
-- Se hereda del reporte padre: si puedes ver el reporte, ves sus entradas.
CREATE POLICY "dre_select" ON daily_report_entries FOR SELECT
  USING (
    report_id IN (
      SELECT id FROM daily_reports
      WHERE workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "dre_insert" ON daily_report_entries FOR INSERT
  WITH CHECK (
    report_id IN (SELECT id FROM daily_reports WHERE profile_id = auth.uid())
  );

CREATE POLICY "dre_delete" ON daily_report_entries FOR DELETE
  USING (
    report_id IN (SELECT id FROM daily_reports WHERE profile_id = auth.uid())
  );

COMMENT ON TABLE daily_reports IS
  'Reporte diario de actividades: una fila por persona y dia laboral del workspace.';
COMMENT ON TABLE daily_report_entries IS
  'Cada actividad narrada durante el dia (a KERN o a mano), con su hora y categoria.';

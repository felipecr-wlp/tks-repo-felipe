-- Reportes ARMADOS (digests) de la bitacora.
--
-- El reporte diario ya guardaba las actividades sueltas y un `summary` por dia.
-- Lo que no existia era el documento: el texto que alguien puede pegar en un
-- correo el viernes sin volver a leer treinta renglones. Eso es lo que vive
-- aqui.
--
-- Se GUARDA en vez de generarse cada vez por dos razones. La primera es costo:
-- cada apertura de la pantalla seria una llamada al modelo por algo que no
-- cambio. La segunda importa mas, un reporte que se redacta distinto cada vez
-- que se abre no es un reporte, es una opinion; si alguien lo cito el lunes,
-- tiene que decir lo mismo el martes.
--
-- `profile_id` NULL significa a proposito "de todo el equipo". Un reporte de
-- equipo no pertenece a nadie y meterlo con el id de quien apreto el boton
-- haria imposible distinguirlo de su reporte personal.

CREATE TABLE IF NOT EXISTS daily_report_digests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id    uuid REFERENCES profiles(id) ON DELETE CASCADE,
  period        text NOT NULL CHECK (period IN ('dia', 'semana', 'rango')),
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  content       text NOT NULL,
  -- Quien lo mando armar. No es lo mismo que profile_id: un jefe puede armar el
  -- reporte de equipo, y ahi profile_id va en NULL.
  generated_by  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT daily_report_digests_rango_valido CHECK (period_end >= period_start)
);

-- Un solo reporte vigente por (persona, periodo, fecha de inicio). Rearmar
-- reemplaza, no acumula: diez versiones del reporte del martes no le sirven a
-- nadie y la mas vieja siempre acabaria siendo la que alguien copia.
--
-- Postgres trata cada NULL como distinto en un UNIQUE normal, asi que el
-- reporte de EQUIPO (profile_id NULL) se duplicaria sin fin. Por eso van dos
-- indices parciales en lugar de uno solo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_report_digests_persona
  ON daily_report_digests(workspace_id, profile_id, period, period_start)
  WHERE profile_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_report_digests_equipo
  ON daily_report_digests(workspace_id, period, period_start)
  WHERE profile_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_daily_report_digests_lookup
  ON daily_report_digests(workspace_id, period_start DESC);

-- RLS encendido y SIN policies de lectura amplia a proposito. Toda la lectura
-- pasa por rutas /api que usan el service role y aplican `isReportSupervisor`
-- en la CONSULTA. La misma regla de privacidad que el resto de la bitacora: el
-- candado autoritativo vive en TypeScript, esto es solo la red debajo.
ALTER TABLE daily_report_digests ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE daily_report_digests IS
  'Reportes redactados (dia, semana o rango) de la bitacora. profile_id NULL = reporte de equipo.';
COMMENT ON COLUMN daily_report_digests.content IS
  'Markdown. Se arma SOLO con lo registrado en daily_report_entries del periodo.';

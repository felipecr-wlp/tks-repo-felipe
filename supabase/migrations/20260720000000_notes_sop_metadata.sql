-- ════════════════════════════════════════════════════════════════════════════
-- SOP como objeto de primera clase: metadatos de proceso sobre `notes`
-- ════════════════════════════════════════════════════════════════════════════
-- No se crea tabla nueva ni motor paralelo: un SOP ES una nota. Solo se agregan
-- columnas de metadato para clasificar una nota como documento operativo (SOP,
-- flujo, indice, capacitacion) y darle ciclo de vida (estatus, version, revision).
--
-- Reglas duras respetadas (landmines TSKR documentadas):
--   - Columnas NULLABLE con default seguro. NADA de FK (no se cierra ningun ciclo
--     entre tablas ya relacionadas -> evita HTTP 300 de PostgREST).
--   - NADA de policy RLS nueva sobre `notes` (evita recursion 42P17). La seguridad
--     de una nota-SOP es exactamente la de cualquier nota (visibility + space_id +
--     membresia), que ya esta cubierta por las policies existentes.
--
-- doc_kind: clasifica el tipo de documento operativo.
--   'note'      -> nota normal (default; comportamiento actual intacto).
--   'sop'       -> procedimiento operativo estandar.
--   'sop_flow'  -> flujo/diagrama de proceso.
--   'sop_index' -> indice de SOPs de un departamento.
--   'training'  -> material de capacitacion / onboarding.
-- sop_status: ciclo de vida (solo relevante si doc_kind <> 'note').
--   'draft' | 'review' | 'active' | 'obsolete'
-- sop_version: version legible del proceso (texto libre, ej. "1.0", "2.3").
-- review_due: proxima fecha de revision; si ya paso, la lente lo marca vencido.
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS doc_kind    text NOT NULL DEFAULT 'note',
  ADD COLUMN IF NOT EXISTS sop_status  text,
  ADD COLUMN IF NOT EXISTS sop_version text,
  ADD COLUMN IF NOT EXISTS review_due  date;

-- Integridad de valores (CHECK, no FK; no cierra ciclos entre tablas).
ALTER TABLE notes
  DROP CONSTRAINT IF EXISTS notes_doc_kind_check;
ALTER TABLE notes
  ADD CONSTRAINT notes_doc_kind_check
  CHECK (doc_kind IN ('note', 'sop', 'sop_flow', 'sop_index', 'training'));

ALTER TABLE notes
  DROP CONSTRAINT IF EXISTS notes_sop_status_check;
ALTER TABLE notes
  ADD CONSTRAINT notes_sop_status_check
  CHECK (sop_status IS NULL OR sop_status IN ('draft', 'review', 'active', 'obsolete'));

-- Indice parcial para la lente "Procesos y SOPs" (solo documentos operativos).
CREATE INDEX IF NOT EXISTS notes_doc_kind_idx
  ON notes (workspace_id, doc_kind)
  WHERE doc_kind <> 'note';

-- Indice para ordenar/filtrar revisiones vencidas.
CREATE INDEX IF NOT EXISTS notes_review_due_idx
  ON notes (workspace_id, review_due)
  WHERE review_due IS NOT NULL;

COMMENT ON COLUMN notes.doc_kind    IS 'Tipo de documento operativo: note|sop|sop_flow|sop_index|training';
COMMENT ON COLUMN notes.sop_status  IS 'Ciclo de vida del SOP: draft|review|active|obsolete';
COMMENT ON COLUMN notes.sop_version IS 'Version legible del proceso (texto libre)';
COMMENT ON COLUMN notes.review_due  IS 'Proxima fecha de revision del SOP';

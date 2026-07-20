-- ─────────────────────────────────────────────────────────────────────────────
-- Robustecer SOPs Nivel 1, Paso 2: acuse de lectura ("Leído y entendido").
-- Aditivo. No toca notes ni ninguna tabla existente. Sigue el patrón de
-- note_comments (seguridad anclada en workspace_members; subqueries a OTRAS
-- tablas, nunca a sí misma -> sin recursión RLS 42P17; FKs unidireccionales
-- note/workspace/profile -> sin ciclos que rompan PostgREST).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS note_acknowledgements (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id         uuid        NOT NULL REFERENCES notes(id)      ON DELETE CASCADE,
  workspace_id    uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id      uuid        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  -- Versión del SOP reconocida: al publicar una versión nueva, el acuse anterior
  -- queda "desactualizado" y la UI puede pedir re-acuse.
  sop_version     text,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, profile_id)
);
ALTER TABLE note_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_nack_note      ON note_acknowledgements(note_id);
CREATE INDEX IF NOT EXISTS idx_nack_profile   ON note_acknowledgements(profile_id);
CREATE INDEX IF NOT EXISTS idx_nack_workspace ON note_acknowledgements(workspace_id);

CREATE POLICY "note_ack_select" ON note_acknowledgements FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "note_ack_insert" ON note_acknowledgements FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
  );

CREATE POLICY "note_ack_update" ON note_acknowledgements FOR UPDATE
  USING (profile_id = auth.uid());

CREATE POLICY "note_ack_delete" ON note_acknowledgements FOR DELETE
  USING (profile_id = auth.uid());

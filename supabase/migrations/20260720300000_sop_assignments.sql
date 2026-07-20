-- ─────────────────────────────────────────────────────────────────────────────
-- SOP Nivel 2, Paso 1: cumplimiento obligatorio (lectores requeridos).
--
-- Nivel 1 dejo el acuse de lectura VOLUNTARIO: cualquiera que abra el SOP puede
-- confirmar, pero nadie esta OBLIGADO y el admin no ve quien falta. Esta tabla
-- permite ASIGNAR un documento operativo a personas, equipos o departamentos que
-- DEBEN acusarlo, para poder medir cumplimiento (quien confirmo la version
-- vigente vs quien esta pendiente o desactualizado).
--
-- Aditivo. Sigue el patron de note_acknowledgements (seguridad anclada en
-- workspace_members; subqueries SOLO a OTRAS tablas -> sin recursion RLS 42P17).
-- Landmines respetadas:
--   - target_id es POLIMORFICO (apunta a profiles, teams o spaces segun
--     target_type), por eso NO lleva FK: evita cerrar cualquier ciclo entre
--     tablas ya relacionadas (HTTP 300 de PostgREST). La validacion de que el
--     objetivo existe y pertenece al workspace se hace en la capa de API.
--   - FKs restantes (note/workspace/assigned_by) son unidireccionales.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sop_assignments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id      uuid        NOT NULL REFERENCES notes(id)      ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- A quien se le exige leer: 'profile' (persona), 'team' (equipo) o 'space'
  -- (departamento). Para 'team'/'space' el conjunto de personas se expande al
  -- leer (team_members / space_members).
  target_type  text        NOT NULL CHECK (target_type IN ('profile', 'team', 'space')),
  target_id    uuid        NOT NULL,
  assigned_by  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (note_id, target_type, target_id)
);
ALTER TABLE sop_assignments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_sopassign_note      ON sop_assignments(note_id);
CREATE INDEX IF NOT EXISTS idx_sopassign_workspace ON sop_assignments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_sopassign_target    ON sop_assignments(target_type, target_id);

-- Ver la asignacion: cualquier miembro del workspace (para saber que un SOP es
-- obligatorio) o un admin de la org.
CREATE POLICY "sop_assign_select" ON sop_assignments FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner', 'admin')
  );

-- Crear/eliminar asignaciones: solo admins del workspace o de la org.
CREATE POLICY "sop_assign_insert" ON sop_assignments FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE profile_id = auth.uid() AND role IN ('owner', 'admin')
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner', 'admin')
  );

CREATE POLICY "sop_assign_delete" ON sop_assignments FOR DELETE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE profile_id = auth.uid() AND role IN ('owner', 'admin')
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner', 'admin')
  );

COMMENT ON TABLE sop_assignments IS 'Lectores requeridos de un SOP (persona/equipo/departamento) para medir cumplimiento del acuse de lectura';

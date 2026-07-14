-- ─────────────────────────────────────────────────────────────────────────────
-- Custom Fields (campos personalizados por proyecto). Paridad ClickUp/Jira.
-- Aditivo. No toca tasks ni ninguna tabla existente.
--
-- Dos tablas:
--   * custom_field_definitions : el CAMPO en si (nombre, tipo, opciones), por proyecto.
--   * task_custom_field_values : el VALOR de ese campo para una tarea concreta.
--
-- Tipos soportados: text, number, currency, date, checkbox, url, select, multi_select.
-- Los select guardan sus opciones en `options` (jsonb: [{id,label,color}]).
-- El valor se guarda tipado en jsonb (string | number | boolean | array de option ids).
--
-- Seguridad anclada en el proyecto, igual que task_watchers / task_saved_views:
-- project_id vive en la fila para que la RLS resuelva membresia sin join extra.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── custom_field_definitions ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS custom_field_definitions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  field_type   text        NOT NULL
                           CHECK (field_type IN ('text','number','currency','date','checkbox','url','select','multi_select')),
  options      jsonb       NOT NULL DEFAULT '[]'::jsonb,   -- [{id,label,color}] para (multi_)select
  position     smallint    NOT NULL DEFAULT 0,
  created_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_cfd_project ON custom_field_definitions(project_id);

-- ─── task_custom_field_values ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_custom_field_values (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  field_id   uuid        NOT NULL REFERENCES custom_field_definitions(id) ON DELETE CASCADE,
  task_id    uuid        NOT NULL REFERENCES tasks(id)    ON DELETE CASCADE,
  project_id uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  value      jsonb,                                        -- string | number | boolean | text[] (option ids)
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (field_id, task_id)
);
ALTER TABLE task_custom_field_values ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_tcfv_task  ON task_custom_field_values(task_id);
CREATE INDEX IF NOT EXISTS idx_tcfv_field ON task_custom_field_values(field_id);
ALTER TABLE task_custom_field_values REPLICA IDENTITY FULL;

-- ─── RLS helper inline: miembro del proyecto o del workspace, o admin/owner ───
-- SELECT definitions
CREATE POLICY "cfd_select" ON custom_field_definitions FOR SELECT
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = auth.uid()
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- INSERT/UPDATE/DELETE definitions: miembro del proyecto (o admin/owner)
CREATE POLICY "cfd_write" ON custom_field_definitions FOR ALL
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  )
  WITH CHECK (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- SELECT values
CREATE POLICY "tcfv_select" ON task_custom_field_values FOR SELECT
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = auth.uid()
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- WRITE values: miembro del proyecto o del workspace
CREATE POLICY "tcfv_write" ON task_custom_field_values FOR ALL
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = auth.uid()
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  )
  WITH CHECK (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = auth.uid()
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── Realtime (best effort) ──────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE task_custom_field_values;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE custom_field_definitions;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

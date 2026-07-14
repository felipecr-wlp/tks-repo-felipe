-- ─────────────────────────────────────────────────────────────────────────────
-- Task Relations (relaciones entre tareas estilo Jira). Paridad ClickUp/Jira.
-- Aditivo. No toca tasks ni ninguna tabla existente.
--
-- Una fila = un enlace dirigido desde source_task_id hacia target_task_id, con un
-- tipo canonico almacenado desde la perspectiva del source:
--   * relates_to   (simetrico: "relacionada con")
--   * duplicates   (source duplica a target; inverso mostrado: "duplicada por")
--
-- NOTA: bloqueo (blocks / bloqueada por) ya vive en la tabla task_dependencies;
-- aqui NO se re-modela para no duplicar. Esta tabla cubre las relaciones no
-- bloqueantes de Jira/ClickUp.
--
-- La UI puede pedir "duplicated_by"; la API lo normaliza invirtiendo source/target
-- y guardando el tipo canonico. Al mostrar las relaciones de una tarea se
-- consultan ambas direcciones (source y target) y se invierte el tipo.
--
-- Seguridad anclada en el proyecto (project_id del source), igual que el resto.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_relations (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_task_id uuid        NOT NULL REFERENCES tasks(id)    ON DELETE CASCADE,
  target_task_id uuid        NOT NULL REFERENCES tasks(id)    ON DELETE CASCADE,
  relation_type  text        NOT NULL
                             CHECK (relation_type IN ('relates_to','duplicates')),
  project_id     uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by     uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (source_task_id <> target_task_id),
  UNIQUE (source_task_id, target_task_id, relation_type)
);
ALTER TABLE task_relations ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_task_relations_source ON task_relations(source_task_id);
CREATE INDEX IF NOT EXISTS idx_task_relations_target ON task_relations(target_task_id);
CREATE INDEX IF NOT EXISTS idx_task_relations_project ON task_relations(project_id);
ALTER TABLE task_relations REPLICA IDENTITY FULL;

-- SELECT: miembro del proyecto, del workspace, o admin/owner.
CREATE POLICY "task_relations_select" ON task_relations FOR SELECT
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = auth.uid()
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- WRITE: miembro del proyecto, del workspace, o admin/owner.
CREATE POLICY "task_relations_write" ON task_relations FOR ALL
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

-- Realtime (best effort).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE task_relations;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

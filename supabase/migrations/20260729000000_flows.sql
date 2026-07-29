-- Flows: diagramas de flujo interactivos con nodos que pueden contener
-- documentos, HTML, URLs o texto. Cada flow es un grafo de nodos + edges
-- almacenado como JSON para React Flow (@xyflow/react).

CREATE TABLE IF NOT EXISTS flows (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         text        NOT NULL DEFAULT 'Flujo sin titulo',
  description   text,
  nodes         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  edges         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  visibility    text        NOT NULL DEFAULT 'workspace'
                            CHECK (visibility IN ('private', 'project', 'team', 'workspace')),
  project_id    uuid        REFERENCES projects(id) ON DELETE SET NULL,
  created_by    uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE flows ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_flows_workspace ON flows(workspace_id);
CREATE INDEX IF NOT EXISTS idx_flows_project   ON flows(project_id);
CREATE INDEX IF NOT EXISTS idx_flows_created_by ON flows(created_by);
CREATE INDEX IF NOT EXISTS idx_flows_updated    ON flows(updated_at DESC);

CREATE TRIGGER flows_updated_at
  BEFORE UPDATE ON flows
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS Policies

CREATE POLICY "flows_select" ON flows FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner', 'admin')
  );

CREATE POLICY "flows_insert" ON flows FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "flows_update" ON flows FOR UPDATE
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner', 'admin')
  );

CREATE POLICY "flows_delete" ON flows FOR DELETE
  USING (
    created_by = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner', 'admin')
    OR (
      SELECT role FROM workspace_members
      WHERE workspace_id = flows.workspace_id AND profile_id = auth.uid()
    ) = 'admin'
  );

-- Flow shares: permisos individuales de acceso a flows
-- Complementa el campo visibility para sharing granular

CREATE TABLE IF NOT EXISTS flow_shares (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  flow_id     uuid        NOT NULL REFERENCES flows(id) ON DELETE CASCADE,
  profile_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  permission  text        NOT NULL DEFAULT 'view' CHECK (permission IN ('view', 'edit')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (flow_id, profile_id)
);

ALTER TABLE flow_shares ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_fs_flow ON flow_shares(flow_id);
CREATE INDEX IF NOT EXISTS idx_fs_profile ON flow_shares(profile_id);

CREATE POLICY "flow_shares_select" ON flow_shares FOR SELECT
  USING (
    profile_id = auth.uid()
    OR flow_id IN (
      SELECT id FROM flows WHERE created_by = auth.uid()
    )
    OR flow_id IN (
      SELECT id FROM flows WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
      )
    )
  );

CREATE POLICY "flow_shares_insert" ON flow_shares FOR INSERT
  WITH CHECK (
    flow_id IN (SELECT id FROM flows WHERE created_by = auth.uid())
  );

CREATE POLICY "flow_shares_delete" ON flow_shares FOR DELETE
  USING (
    flow_id IN (SELECT id FROM flows WHERE created_by = auth.uid())
  );

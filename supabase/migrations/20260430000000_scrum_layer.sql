-- ════════════════════════════════════════════════════════════════════════════
-- SCRUM LAYER
-- Capa ágil sobre el task engine existente. Aditiva: no toca datos previos.
--   * sprints           : iteraciones con fecha, por equipo
--   * tasks.sprint_id    : task -> sprint (NULL = backlog)
--   * tasks.story_points : estimación de esfuerzo (Fibonacci)
--   * tasks.story_points_done : esfuerzo real al cerrar
--   * tasks.area         : plataforma / área (Meta, Google Ads, SEO, UX...)
-- ════════════════════════════════════════════════════════════════════════════

-- ─── sprints ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sprints (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  team_id      uuid        NOT NULL REFERENCES teams(id)      ON DELETE CASCADE,
  name         text        NOT NULL,
  goal         text,
  status       text        NOT NULL DEFAULT 'planning'
                           CHECK (status IN ('planning','active','completed')),
  start_date   date,
  end_date     date,
  created_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sprints ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS sprints_team_idx   ON sprints(team_id);
CREATE INDEX IF NOT EXISTS sprints_status_idx ON sprints(team_id, status);

-- ─── columnas SCRUM en tasks ─────────────────────────────────────────────────
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS sprint_id         uuid     REFERENCES sprints(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS story_points      smallint CHECK (story_points      IS NULL OR story_points      IN (1,2,3,5,8,13,21)),
  ADD COLUMN IF NOT EXISTS story_points_done smallint CHECK (story_points_done IS NULL OR story_points_done IN (1,2,3,5,8,13,21)),
  ADD COLUMN IF NOT EXISTS area              text;

CREATE INDEX IF NOT EXISTS tasks_sprint_idx ON tasks(sprint_id);

-- ─── trigger updated_at ──────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS sprints_updated_at ON sprints;
CREATE TRIGGER sprints_updated_at BEFORE UPDATE ON sprints
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── RLS sprints (mismo molde que tasks: miembros del equipo + org admins) ────
CREATE POLICY "sprints_select" ON sprints FOR SELECT
  USING (
    (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR team_id IN (SELECT team_id FROM team_members WHERE profile_id = auth.uid())
  );

CREATE POLICY "sprints_insert" ON sprints FOR INSERT
  WITH CHECK (
    team_id IN (SELECT team_id FROM team_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "sprints_update" ON sprints FOR UPDATE
  USING (
    team_id IN (SELECT team_id FROM team_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "sprints_delete" ON sprints FOR DELETE
  USING (
    created_by = auth.uid()
    OR team_id IN (SELECT team_id FROM team_members WHERE profile_id = auth.uid() AND role = 'admin')
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

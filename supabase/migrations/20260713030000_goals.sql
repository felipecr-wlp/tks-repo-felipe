-- ─────────────────────────────────────────────────────────────────────────────
-- Goals / OKR (metas de workspace estilo ClickUp Goals / Jira). Aditivo.
-- No toca tasks ni ninguna tabla existente.
--
-- Una meta pertenece a UN workspace. El progreso puede calcularse de dos formas:
--   * manual  -> el usuario fija current_value / target_value a mano.
--   * tasks    -> current/target se derivan de las tareas enlazadas (done / total).
--
-- goal_tasks enlaza una meta con tareas concretas (para el modo 'tasks' y para
-- ver el desglose). El enlace es best-effort: si la tarea se borra, CASCADE limpia.
--
-- Seguridad anclada en el workspace, igual que el resto del producto: miembro del
-- workspace o admin/owner de la org.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS goals (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title         text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description   text,
  unit          text        NOT NULL DEFAULT 'percent'
                            CHECK (unit IN ('percent','number','currency','tasks')),
  progress_mode text        NOT NULL DEFAULT 'manual'
                            CHECK (progress_mode IN ('manual','tasks')),
  target_value  numeric     NOT NULL DEFAULT 100,
  current_value numeric     NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'on_track'
                            CHECK (status IN ('on_track','at_risk','off_track','done')),
  due_date      date,
  owner_id      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_by    uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_goals_workspace ON goals(workspace_id);
CREATE INDEX IF NOT EXISTS idx_goals_owner ON goals(owner_id);
ALTER TABLE goals REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS goal_tasks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  goal_id    uuid        NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  task_id    uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (goal_id, task_id)
);
ALTER TABLE goal_tasks ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_goal_tasks_goal ON goal_tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_goal_tasks_task ON goal_tasks(task_id);
ALTER TABLE goal_tasks REPLICA IDENTITY FULL;

-- ── RLS goals: miembro del workspace o admin/owner de la org ──────────────────
CREATE POLICY "goals_select" ON goals FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "goals_write" ON goals FOR ALL
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  )
  WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ── RLS goal_tasks: hereda del goal (mismo workspace) ─────────────────────────
CREATE POLICY "goal_tasks_select" ON goal_tasks FOR SELECT
  USING (
    goal_id IN (
      SELECT g.id FROM goals g
      WHERE g.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "goal_tasks_write" ON goal_tasks FOR ALL
  USING (
    goal_id IN (
      SELECT g.id FROM goals g
      WHERE g.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  )
  WITH CHECK (
    goal_id IN (
      SELECT g.id FROM goals g
      WHERE g.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- Realtime (best effort).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE goals;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE goal_tasks;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

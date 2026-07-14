-- ─────────────────────────────────────────────────────────────────────────────
-- Optimizacion de RLS para las tablas nuevas (task_relations, goals, goal_tasks).
-- No cambia la SEGURIDAD, solo el rendimiento. Dos correcciones que marca el
-- linter de Supabase:
--
--   1. auth_rls_initplan: `auth.uid()` suelto se re-evalua fila por fila. Se
--      envuelve en `(SELECT auth.uid())` para que Postgres lo cachee (initplan).
--      Importa aqui porque estas tablas tienen Realtime (RLS corre en cada cambio).
--
--   2. multiple_permissive_policies: la policy `FOR ALL` tambien cubria SELECT, asi
--      que cada lectura evaluaba DOS policies. Se separa la escritura en
--      INSERT / UPDATE / DELETE para que SELECT tenga una sola policy.
--
-- Patron: DROP de las policies viejas + CREATE optimizadas con el MISMO predicado.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── task_relations (anclada en proyecto) ─────────────────────────────────────
DROP POLICY IF EXISTS "task_relations_select" ON task_relations;
DROP POLICY IF EXISTS "task_relations_write"  ON task_relations;

CREATE POLICY "task_relations_select" ON task_relations FOR SELECT
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = (SELECT auth.uid()))
    OR project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = (SELECT auth.uid())
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "task_relations_insert" ON task_relations FOR INSERT
  WITH CHECK (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = (SELECT auth.uid()))
    OR project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = (SELECT auth.uid())
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "task_relations_update" ON task_relations FOR UPDATE
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = (SELECT auth.uid()))
    OR project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = (SELECT auth.uid())
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  )
  WITH CHECK (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = (SELECT auth.uid()))
    OR project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = (SELECT auth.uid())
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "task_relations_delete" ON task_relations FOR DELETE
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = (SELECT auth.uid()))
    OR project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = (SELECT auth.uid())
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

-- ── goals (anclada en workspace) ─────────────────────────────────────────────
DROP POLICY IF EXISTS "goals_select" ON goals;
DROP POLICY IF EXISTS "goals_write"  ON goals;

CREATE POLICY "goals_select" ON goals FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = (SELECT auth.uid()))
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "goals_insert" ON goals FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = (SELECT auth.uid()))
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "goals_update" ON goals FOR UPDATE
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = (SELECT auth.uid()))
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  )
  WITH CHECK (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = (SELECT auth.uid()))
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "goals_delete" ON goals FOR DELETE
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = (SELECT auth.uid()))
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

-- ── goal_tasks (hereda del goal / workspace) ─────────────────────────────────
DROP POLICY IF EXISTS "goal_tasks_select" ON goal_tasks;
DROP POLICY IF EXISTS "goal_tasks_write"  ON goal_tasks;

CREATE POLICY "goal_tasks_select" ON goal_tasks FOR SELECT
  USING (
    goal_id IN (
      SELECT g.id FROM goals g
      WHERE g.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = (SELECT auth.uid()))
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "goal_tasks_insert" ON goal_tasks FOR INSERT
  WITH CHECK (
    goal_id IN (
      SELECT g.id FROM goals g
      WHERE g.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = (SELECT auth.uid()))
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "goal_tasks_update" ON goal_tasks FOR UPDATE
  USING (
    goal_id IN (
      SELECT g.id FROM goals g
      WHERE g.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = (SELECT auth.uid()))
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  )
  WITH CHECK (
    goal_id IN (
      SELECT g.id FROM goals g
      WHERE g.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = (SELECT auth.uid()))
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "goal_tasks_delete" ON goal_tasks FOR DELETE
  USING (
    goal_id IN (
      SELECT g.id FROM goals g
      WHERE g.workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = (SELECT auth.uid()))
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

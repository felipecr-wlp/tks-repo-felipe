-- ─────────────────────────────────────────────────────────────────────────────
-- Cierra 4 tablas que quedaron con RLS habilitada pero SIN policies (hallazgo
-- INFO del linter: rls_enabled_no_policy). Sin policies, la tabla queda en
-- deny-all para el cliente de usuario, asi que si la app lee/escribe por el
-- cliente autenticado (no admin) se rompe en silencio. Se agregan policies con el
-- MISMO modelo que las tablas hermanas ya seguras, usando (SELECT auth.uid())
-- para no introducir el lint de rendimiento (initplan).
--
--   messages         -> anclada en el EQUIPO (team_members).
--   task_attachments -> anclada en el PROYECTO (project_members), como task_comments.
--   task_mentions    -> anclada en el proyecto de la tarea + el mencionado/mencionador.
--   task_saved_views -> vistas PERSONALES: dueño = profile_id.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── messages (chat de equipo) ────────────────────────────────────────────────
DROP POLICY IF EXISTS "messages_select" ON messages;
DROP POLICY IF EXISTS "messages_insert" ON messages;
DROP POLICY IF EXISTS "messages_delete" ON messages;

CREATE POLICY "messages_select" ON messages FOR SELECT
  USING (
    team_id IN (SELECT team_id FROM team_members WHERE profile_id = (SELECT auth.uid()))
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "messages_insert" ON messages FOR INSERT
  WITH CHECK (
    author_id = (SELECT auth.uid())
    AND team_id IN (SELECT team_id FROM team_members WHERE profile_id = (SELECT auth.uid()))
  );

CREATE POLICY "messages_delete" ON messages FOR DELETE
  USING (
    author_id = (SELECT auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

-- ── task_attachments (adjuntos de tarea) ─────────────────────────────────────
DROP POLICY IF EXISTS "task_attachments_select" ON task_attachments;
DROP POLICY IF EXISTS "task_attachments_insert" ON task_attachments;
DROP POLICY IF EXISTS "task_attachments_delete" ON task_attachments;

CREATE POLICY "task_attachments_select" ON task_attachments FOR SELECT
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = (SELECT auth.uid()))
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "task_attachments_insert" ON task_attachments FOR INSERT
  WITH CHECK (
    uploaded_by = (SELECT auth.uid())
    AND project_id IN (
      SELECT project_id FROM project_members
      WHERE profile_id = (SELECT auth.uid()) AND role IN ('manager','member')
    )
  );

CREATE POLICY "task_attachments_delete" ON task_attachments FOR DELETE
  USING (
    uploaded_by = (SELECT auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

-- ── task_mentions (menciones @ en tareas) ────────────────────────────────────
DROP POLICY IF EXISTS "task_mentions_select" ON task_mentions;
DROP POLICY IF EXISTS "task_mentions_insert" ON task_mentions;
DROP POLICY IF EXISTS "task_mentions_delete" ON task_mentions;

CREATE POLICY "task_mentions_select" ON task_mentions FOR SELECT
  USING (
    mentioned_id = (SELECT auth.uid())
    OR mentioned_by = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_mentions.task_id
        AND t.project_id IN (SELECT project_id FROM project_members WHERE profile_id = (SELECT auth.uid()))
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "task_mentions_insert" ON task_mentions FOR INSERT
  WITH CHECK (
    mentioned_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_mentions.task_id
        AND t.project_id IN (
          SELECT project_id FROM project_members
          WHERE profile_id = (SELECT auth.uid()) AND role IN ('manager','member')
        )
    )
  );

CREATE POLICY "task_mentions_delete" ON task_mentions FOR DELETE
  USING (
    mentioned_by = (SELECT auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

-- ── task_saved_views (vistas guardadas, personales) ──────────────────────────
DROP POLICY IF EXISTS "task_saved_views_select" ON task_saved_views;
DROP POLICY IF EXISTS "task_saved_views_insert" ON task_saved_views;
DROP POLICY IF EXISTS "task_saved_views_update" ON task_saved_views;
DROP POLICY IF EXISTS "task_saved_views_delete" ON task_saved_views;

CREATE POLICY "task_saved_views_select" ON task_saved_views FOR SELECT
  USING (profile_id = (SELECT auth.uid()));

CREATE POLICY "task_saved_views_insert" ON task_saved_views FOR INSERT
  WITH CHECK (
    profile_id = (SELECT auth.uid())
    AND project_id IN (SELECT project_id FROM project_members WHERE profile_id = (SELECT auth.uid()))
  );

CREATE POLICY "task_saved_views_update" ON task_saved_views FOR UPDATE
  USING (profile_id = (SELECT auth.uid()))
  WITH CHECK (profile_id = (SELECT auth.uid()));

CREATE POLICY "task_saved_views_delete" ON task_saved_views FOR DELETE
  USING (profile_id = (SELECT auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- Amplia la visibilidad de task_saved_views para soportar vistas COMPARTIDAS.
--
-- La policy original (20260714020000_rls_policies_orphan_tables.sql) solo dejaba
-- ver las vistas propias (profile_id = auth.uid()). Con la columna is_shared, una
-- vista compartida debe ser visible para cualquier miembro del proyecto, sin dejar
-- de ver siempre las propias. Insert / update / delete NO cambian: siguen ancladas
-- al dueño (solo el creador administra su vista), igual que antes.
--
-- Se usa (SELECT auth.uid()) para no reintroducir el lint de rendimiento initplan,
-- igual que el resto de las policies del schema.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "task_saved_views_select" ON task_saved_views;

CREATE POLICY "task_saved_views_select" ON task_saved_views FOR SELECT
  USING (
    profile_id = (SELECT auth.uid())
    OR (
      is_shared
      AND project_id IN (
        SELECT project_id FROM project_members WHERE profile_id = (SELECT auth.uid())
      )
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

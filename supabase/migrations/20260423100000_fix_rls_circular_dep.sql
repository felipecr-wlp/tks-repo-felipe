-- ════════════════════════════════════════════════════════════
-- Fix: romper dependencia circular entre workspaces y workspace_members
-- ════════════════════════════════════════════════════════════
-- Problema:
--   workspaces_select         → necesita workspace_members_select
--   workspace_members_select  → necesita workspaces_select
--
--   Postgres no resuelve este ciclo cuando el usuario NO tiene
--   org_role IN ('owner','admin'), y queda bloqueado de ver sus propios
--   workspaces aunque sea miembro.
--
-- Solución:
--   - workspace_members_select ya no requiere que el workspace sea visible;
--     se valida solo por propia membresía u otras membresías del usuario.
--   - La integridad org-tenant se mantiene porque workspace.org_id es
--     inmutable y la RLS de workspaces sigue filtrando por auth_org_id().
-- ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "workspace_members_select" ON workspace_members;

CREATE POLICY "workspace_members_select" ON workspace_members FOR SELECT
  USING (
    -- Propia membresía (rompe el ciclo)
    profile_id = auth.uid()
    -- Org owners/admins ven todo
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    -- Otros miembros del mismo workspace
    OR workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm
      WHERE wm.profile_id = auth.uid()
    )
  );

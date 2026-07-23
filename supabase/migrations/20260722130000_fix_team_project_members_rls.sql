-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: recursion infinita latente (Postgres 42P17) en las policies
-- team_members_insert / team_members_delete y
-- project_members_select / project_members_insert / project_members_delete.
--
-- Igual que el caso ya resuelto de workspace_members (20260719020000 +
-- 20260722120000), estas cinco policies del schema canonico (20260421000000)
-- hacen un subquery directo sobre su PROPIA tabla dentro del cuerpo USING/WITH
-- CHECK:
--
--   team_members_insert / _delete:
--     team_id IN (SELECT team_id FROM team_members
--                 WHERE profile_id = auth.uid() AND role = 'admin')
--
--   project_members_select:
--     project_id IN (SELECT project_id FROM project_members
--                    WHERE profile_id = auth.uid())
--   project_members_insert / _delete:
--     project_id IN (SELECT project_id FROM project_members
--                    WHERE profile_id = auth.uid() AND role = 'manager')
--
-- Bajo RLS ese subquery se evalua contra la misma policy y dispara
-- "infinite recursion detected in policy for relation team_members" /
-- "... project_members" en cualquier operacion de un rol distinto de
-- service_role. Hoy no truena porque TODAS las escrituras de membresias pasan
-- por el admin client (service role) que ignora RLS; es una bomba latente.
--
-- Solucion: mismo patron SECURITY DEFINER que user_workspace_ids() /
-- user_admin_workspace_ids(). Se agregan helpers STABLE SECURITY DEFINER que
-- leen team_members / project_members SIN volver a disparar RLS (rompen el
-- ciclo) y se recrean las cinco policies con semantica EQUIVALENTE a la
-- original. Las clausulas que NO se auto-referencian (org owner/admin via
-- profiles; workspace-admin via projects JOIN workspace_members) se conservan
-- tal cual.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── Helpers SECURITY DEFINER ────────────────────────────────────────────────

-- Equipos donde el usuario es admin del equipo (rompe la auto-referencia sobre
-- team_members). Espeja user_admin_workspace_ids().
CREATE OR REPLACE FUNCTION public.user_admin_team_ids()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT team_id
  FROM public.team_members
  WHERE profile_id = auth.uid()
    AND role = 'admin'
$$;

-- Proyectos donde el usuario es miembro (cualquier rol). Rompe la
-- auto-referencia sobre project_members en project_members_select.
CREATE OR REPLACE FUNCTION public.user_project_ids()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT project_id
  FROM public.project_members
  WHERE profile_id = auth.uid()
$$;

-- Proyectos donde el usuario es manager del proyecto. Rompe la auto-referencia
-- sobre project_members en project_members_insert / _delete.
CREATE OR REPLACE FUNCTION public.user_manager_project_ids()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT project_id
  FROM public.project_members
  WHERE profile_id = auth.uid()
    AND role = 'manager'
$$;

-- ─── team_members INSERT ─────────────────────────────────────────────────────
-- Semantica original: admin del equipo, o org owner/admin.
DROP POLICY IF EXISTS "team_members_insert" ON public.team_members;

CREATE POLICY "team_members_insert" ON public.team_members FOR INSERT
  WITH CHECK (
    -- Admin del equipo, via helper SECURITY DEFINER (rompe el ciclo)
    team_id IN (SELECT public.user_admin_team_ids())
    OR (SELECT org_role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── team_members DELETE ─────────────────────────────────────────────────────
-- Semantica original: propia membresia, o admin del equipo, o org owner/admin.
DROP POLICY IF EXISTS "team_members_delete" ON public.team_members;

CREATE POLICY "team_members_delete" ON public.team_members FOR DELETE
  USING (
    -- Un usuario puede quitar su propia membresia
    profile_id = auth.uid()
    -- Admin del equipo, via helper SECURITY DEFINER (rompe el ciclo)
    OR team_id IN (SELECT public.user_admin_team_ids())
    OR (SELECT org_role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── project_members SELECT ──────────────────────────────────────────────────
-- Semantica original: miembros de los mismos proyectos del usuario, o org
-- owner/admin.
DROP POLICY IF EXISTS "project_members_select" ON public.project_members;

CREATE POLICY "project_members_select" ON public.project_members FOR SELECT
  USING (
    -- Proyectos del usuario, via helper SECURITY DEFINER (rompe el ciclo)
    project_id IN (SELECT public.user_project_ids())
    OR (SELECT org_role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── project_members INSERT ──────────────────────────────────────────────────
-- Semantica original: manager del proyecto, o org owner/admin, o admin del
-- workspace dueño del proyecto (via projects JOIN workspace_members; no toca
-- project_members, se conserva intacta).
DROP POLICY IF EXISTS "project_members_insert" ON public.project_members;

CREATE POLICY "project_members_insert" ON public.project_members FOR INSERT
  WITH CHECK (
    -- Manager del proyecto, via helper SECURITY DEFINER (rompe el ciclo)
    project_id IN (SELECT public.user_manager_project_ids())
    OR (SELECT org_role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR project_id IN (
      SELECT p.id FROM public.projects p
      JOIN public.workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = auth.uid() AND wm.role = 'admin'
    )
  );

-- ─── project_members DELETE ──────────────────────────────────────────────────
-- Semantica original: propia membresia, o manager del proyecto, o org
-- owner/admin.
DROP POLICY IF EXISTS "project_members_delete" ON public.project_members;

CREATE POLICY "project_members_delete" ON public.project_members FOR DELETE
  USING (
    -- Un usuario puede quitar su propia membresia
    profile_id = auth.uid()
    -- Manager del proyecto, via helper SECURITY DEFINER (rompe el ciclo)
    OR project_id IN (SELECT public.user_manager_project_ids())
    OR (SELECT org_role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

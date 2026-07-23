-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: recursion infinita latente (Postgres 42P17) en las policies
-- workspace_members_insert y workspace_members_delete.
--
-- El fix de julio (20260719020000) solo reescribio workspace_members_select con
-- el helper SECURITY DEFINER user_workspace_ids(). Las policies INSERT y DELETE
-- del schema canonico (20260421000000) siguen haciendo un subquery directo sobre
-- la MISMA tabla workspace_members dentro de su clausula de admin:
--
--   OR workspace_id IN (
--     SELECT workspace_id FROM workspace_members
--     WHERE profile_id = auth.uid() AND role = 'admin'
--   )
--
-- Bajo RLS ese subquery se evalua contra la propia policy y dispara
-- "infinite recursion detected in policy for relation workspace_members" en
-- cualquier INSERT/DELETE de un rol distinto de service_role. Se manifiesta al
-- gestionar membresias (agregar/quitar miembros de un workspace) sin el admin
-- client.
--
-- Solucion: mismo patron que user_workspace_ids(). Se agrega un helper
-- SECURITY DEFINER STABLE, user_admin_workspace_ids(), que lee workspace_members
-- SIN volver a disparar RLS (rompiendo el ciclo) y devuelve solo los workspaces
-- donde el usuario tiene role = 'admin'. Se recrean ambas policies con semantica
-- EQUIVALENTE a la original: puede insertar/borrar filas de membresia solo en
-- workspaces de su org donde es org owner/admin, o donde es admin del workspace;
-- ademas DELETE permite que un usuario elimine su propia membresia (profile_id =
-- auth.uid()), igual que el schema original.
-- ─────────────────────────────────────────────────────────────────────────────

-- Helper: workspaces donde el usuario es admin del workspace (SECURITY DEFINER
-- evita la auto-referencia recursiva sobre workspace_members). Espeja el patron
-- de public.user_workspace_ids() introducido en 20260719020000.
CREATE OR REPLACE FUNCTION public.user_admin_workspace_ids()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT workspace_id
  FROM public.workspace_members
  WHERE profile_id = auth.uid()
    AND role = 'admin'
$$;

-- ─── INSERT ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "workspace_members_insert" ON public.workspace_members;

CREATE POLICY "workspace_members_insert" ON public.workspace_members FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT id FROM public.workspaces WHERE org_id = auth_org_id())
    AND (
      -- Org owners/admins
      (SELECT org_role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin')
      -- Admin del workspace, via helper SECURITY DEFINER (rompe el ciclo)
      OR workspace_id IN (SELECT public.user_admin_workspace_ids())
    )
  );

-- ─── DELETE ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "workspace_members_delete" ON public.workspace_members;

CREATE POLICY "workspace_members_delete" ON public.workspace_members FOR DELETE
  USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE org_id = auth_org_id())
    AND (
      -- Un usuario puede quitar su propia membresia
      profile_id = auth.uid()
      -- Org owners/admins
      OR (SELECT org_role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin')
      -- Admin del workspace, via helper SECURITY DEFINER (rompe el ciclo)
      OR workspace_id IN (SELECT public.user_admin_workspace_ids())
    )
  );

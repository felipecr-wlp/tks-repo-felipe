-- ─────────────────────────────────────────────────────────────────────────────
-- Fix: recursion infinita (Postgres 42P17) en la policy workspace_members_select.
--
-- La tercera clausula de la policy hacia un subquery sobre la MISMA tabla
-- workspace_members, lo que dispara "infinite recursion detected in policy for
-- relation workspace_members" en cualquier SELECT sujeto a RLS (rol distinto de
-- service_role). El app lo enmascaraba usando el admin client (service role) para
-- todas las lecturas criticas de workspace_members, asi que solo se manifestaba
-- como un switcher de workspaces vacio en silencio. Al quedar visible tras
-- arreglar el HTTP 300, se corrige de raiz.
--
-- Solucion: helper SECURITY DEFINER (mismo patron que auth_org_id()) que lee
-- workspace_members SIN volver a disparar RLS, rompiendo el ciclo. Arreglar esta
-- policy raiz tambien resuelve la recursion indirecta en workspaces_select y en la
-- policy DELETE de workspace_members, que ambas hacen subquery a workspace_members.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_workspace_ids()
  RETURNS SETOF uuid
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path TO 'public'
AS $$
  SELECT workspace_id FROM public.workspace_members WHERE profile_id = auth.uid()
$$;

DROP POLICY IF EXISTS "workspace_members_select" ON public.workspace_members;

CREATE POLICY "workspace_members_select" ON public.workspace_members FOR SELECT
  USING (
    -- Propia membresia (rompe el ciclo)
    profile_id = auth.uid()
    -- Org owners/admins ven todo
    OR (SELECT org_role FROM public.profiles WHERE id = auth.uid()) IN ('owner','admin')
    -- Otros miembros de los mismos workspaces del usuario, via helper SECURITY
    -- DEFINER (evita la auto-referencia recursiva sobre workspace_members)
    OR workspace_id IN (SELECT public.user_workspace_ids())
  );

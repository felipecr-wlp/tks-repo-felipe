-- ─────────────────────────────────────────────────────────────────────────────
-- Fix outage: circular FK entre workspaces y organizations rompia los embeds.
--
-- La migracion 20260719000000_org_domain_autojoin agrego
-- organizations.default_workspace_id como FK a workspaces. Eso creo un ciclo de
-- foreign keys (workspaces.org_id -> organizations Y
-- organizations.default_workspace_id -> workspaces). A partir de ahi PostgREST
-- devuelve HTTP 300 "Multiple Choices" en CUALQUIER embed organizations(...) bajo
-- workspaces, porque no puede decidir que relacion usar. El layout del workspace
-- (que hace ese embed con el admin client) recibia null y disparaba notFound()
-- para TODOS los usuarios -> "Pagina no encontrada".
--
-- auto-join.ts usa default_workspace_id SOLO como columna (nunca como relacion
-- embebida), asi que soltar el constraint conserva la columna y sus datos, y
-- elimina la ambiguedad. El FK legitimo workspaces_org_id_fkey se mantiene.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_default_workspace_id_fkey;

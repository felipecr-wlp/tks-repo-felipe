-- ─────────────────────────────────────────────────────────────────────────────
-- Auto-join por dominio de correo.
--
-- Problema: cada usuario que se registra SIN invitacion pasa por /onboarding y
-- crea una organizacion nueva, quedando aislado en un workspace propio (ya paso
-- 2 veces: dos "General"). El unico camino correcto de alta era la invitacion.
--
-- Fix: la organizacion de la empresa declara (a) su dominio de correo y (b) su
-- workspace por defecto. Al registrarse alguien con ese dominio y sin org, el app
-- lo une automaticamente a esa org + workspace (rol member) en vez de crear una
-- org nueva. La config de datos (dominio = pavific.com) se aplica por separado en
-- produccion, no aqui, para que esta migracion sea replayable en una BD limpia.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS email_domain text;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_workspace_id uuid
  REFERENCES workspaces(id) ON DELETE SET NULL;

-- Un dominio mapea a lo sumo a una org (evita ambiguedad en el auto-join).
CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_email_domain
  ON organizations (lower(email_domain)) WHERE email_domain IS NOT NULL;

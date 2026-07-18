-- ════════════════════════════════════════════════════════════════════════════
-- F0 Docs/Confluence: Espacios = Departamentos (independientes de los equipos)
-- ════════════════════════════════════════════════════════════════════════════
-- Un "Espacio" es un agrupador de nivel departamento (RH, Marketing, Legal) que
-- vive dentro de un workspace y agrupa notas (paginas). NO duplica el motor de
-- documentos: las paginas siguen en la tabla `notes` (arbol, versiones, backlinks,
-- comentarios, tsvector ya existentes). Aqui solo se agrega:
--   1. `spaces`          -> el departamento (nombre, icono, color, restringido?).
--   2. `space_members`   -> quien pertenece a cada departamento y con que rol.
--   3. `notes.space_id`  -> a que departamento pertenece una pagina (opcional; una
--                           nota sin space_id es global del workspace, como hoy).
--
-- RLS de esta fase (F0) es ADITIVA y NO destructiva: se agrega una policy extra de
-- SELECT sobre `notes` para que los miembros de un espacio vean sus paginas. Las
-- policies de notas existentes se dejan intactas (Postgres combina permissive con
-- OR). El ocultamiento estricto de espacios restringidos se termina en F3.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Helper: ¿el usuario es miembro del espacio? ─────────────────────────────
-- Mismo patron que is_workspace_member / is_project_member (SECURITY DEFINER,
-- search_path fijo) para ser consistente con el esquema base.
CREATE OR REPLACE FUNCTION is_space_member(sp_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM space_members
    WHERE space_id = sp_id
      AND profile_id = auth.uid()
  )
$$;

-- ── Helper: ¿el usuario es admin/owner del espacio? ─────────────────────────
CREATE OR REPLACE FUNCTION is_space_admin(sp_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM space_members
    WHERE space_id = sp_id
      AND profile_id = auth.uid()
      AND role IN ('owner', 'admin')
  )
$$;

-- ── Tabla: spaces (departamentos) ───────────────────────────────────────────
CREATE TABLE spaces (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  description     text,
  icon            text,                            -- nombre de icono lucide
  color           text,                            -- token/hex para el acento del depto
  -- Restringido: cuando es true, solo los space_members ven el espacio y sus
  -- paginas (se aplica en F3). Cuando es false, es visible para el workspace.
  is_restricted   boolean     NOT NULL DEFAULT false,
  is_archived     boolean     NOT NULL DEFAULT false,
  created_by      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_spaces_workspace ON spaces(workspace_id);
CREATE INDEX idx_spaces_org       ON spaces(organization_id);

CREATE TRIGGER trg_spaces_updated_at
  BEFORE UPDATE ON spaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Tabla: space_members (pertenencia por departamento) ─────────────────────
-- Reusa el enum workspace_role (owner/admin/member) para no inventar roles.
CREATE TABLE space_members (
  space_id   uuid           NOT NULL REFERENCES spaces(id) ON DELETE CASCADE,
  profile_id uuid           NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       workspace_role NOT NULL DEFAULT 'member',
  added_by   uuid           REFERENCES profiles(id) ON DELETE SET NULL,
  joined_at  timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (space_id, profile_id)
);

CREATE INDEX idx_space_members_profile ON space_members(profile_id);

-- ── Columna: notes.space_id (a que departamento pertenece la pagina) ────────
ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES spaces(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notes_space ON notes(space_id);

-- ════════════════════════════════════════════════════════════════════════════
-- RLS
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE spaces        ENABLE ROW LEVEL SECURITY;
ALTER TABLE space_members ENABLE ROW LEVEL SECURITY;

-- ── spaces ──────────────────────────────────────────────────────────────────
-- Ver: admin de org; o miembro del espacio; o (no restringido y miembro del ws).
CREATE POLICY "spaces_select" ON spaces FOR SELECT
  USING (
    organization_id = auth_org_id()
    AND (
      is_org_admin()
      OR is_space_member(id)
      OR (is_restricted = false AND is_workspace_member(workspace_id))
    )
  );

-- Crear: cualquier miembro del workspace, registrado como creador.
CREATE POLICY "spaces_insert" ON spaces FOR INSERT
  WITH CHECK (
    organization_id = auth_org_id()
    AND created_by = auth.uid()
    AND is_workspace_member(workspace_id)
  );

-- Editar: admin de org, o admin/owner del propio espacio, o su creador.
CREATE POLICY "spaces_update" ON spaces FOR UPDATE
  USING (
    organization_id = auth_org_id()
    AND (is_org_admin() OR is_space_admin(id) OR created_by = auth.uid())
  );

-- Borrar: admin de org, o admin/owner del espacio, o su creador.
CREATE POLICY "spaces_delete" ON spaces FOR DELETE
  USING (
    organization_id = auth_org_id()
    AND (is_org_admin() OR is_space_admin(id) OR created_by = auth.uid())
  );

-- ── space_members ───────────────────────────────────────────────────────────
-- Ver la membresia: admin de org, o quien pertenece al mismo espacio.
CREATE POLICY "space_members_select" ON space_members FOR SELECT
  USING (is_org_admin() OR is_space_member(space_id));

-- Agregar miembros: admin de org, o admin/owner del espacio.
CREATE POLICY "space_members_insert" ON space_members FOR INSERT
  WITH CHECK (is_org_admin() OR is_space_admin(space_id));

-- Cambiar rol: admin de org, o admin/owner del espacio.
CREATE POLICY "space_members_update" ON space_members FOR UPDATE
  USING (is_org_admin() OR is_space_admin(space_id));

-- Quitar miembros: admin de org, admin/owner del espacio, o el propio miembro
-- (salir del espacio por su cuenta).
CREATE POLICY "space_members_delete" ON space_members FOR DELETE
  USING (is_org_admin() OR is_space_admin(space_id) OR profile_id = auth.uid());

-- ── notes: policy ADITIVA para paginas dentro de un espacio ─────────────────
-- No se toca la policy "notes_select" existente. Postgres combina las permissive
-- con OR: esta agrega acceso cuando la nota pertenece a un espacio al que el
-- usuario puede entrar (miembro, o espacio no restringido y miembro del ws).
CREATE POLICY "notes_select_space" ON notes FOR SELECT
  USING (
    organization_id = auth_org_id()
    AND space_id IS NOT NULL
    AND (
      is_org_admin()
      OR is_space_member(space_id)
      OR (is_workspace_member(workspace_id) AND EXISTS (
        SELECT 1 FROM spaces s
        WHERE s.id = notes.space_id AND s.is_restricted = false
      ))
    )
  );

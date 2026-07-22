-- ─────────────────────────────────────────────────────────────────────────────
-- task_saved_views: vistas guardadas de un tablero de proyecto.
--
-- Una vista guardada es una combinacion NOMBRADA de filtros (estado, prioridad,
-- asignado, etiquetas, texto de busqueda) mas un orden, que el usuario reusa con
-- un clic. Por defecto es PRIVADA del creador; is_shared la comparte con todo el
-- proyecto.
--
-- Esta migracion CREA la tabla. Debe correr ANTES de
-- 20260714020000_rls_policies_orphan_tables.sql, que agrega las policies contra
-- esta tabla (por eso el timestamp 20260714015000, entre 010000 y 020000).
--
-- Modelo de seguridad (identico a las tablas hermanas ancladas en el proyecto,
-- ej. task_attachments): acceso por membresia del proyecto. Las policies finas
-- (dueño = profile_id para privadas, compartidas visibles a miembros) viven en
-- 20260714020000; aqui solo se habilita RLS. La app lee/escribe por el admin
-- client (service_role) validando membresia en el handler, asi que RLS es la
-- red de seguridad para el cliente autenticado.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_saved_views (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid        NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
  profile_id uuid        NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  created_by uuid        REFERENCES profiles(id)           ON DELETE SET NULL,
  name       text        NOT NULL,
  -- { assignees:[], statuses:[], priorities:[], labels:[], search:'' } o la forma
  -- corta { view, status, priority, assignee } que ya usa el tablero actual.
  filters    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- { field, dir } para el orden; null = usar el orden por defecto del tablero.
  sort       jsonb,
  -- false = privada del creador; true = compartida con todo el proyecto.
  is_shared  boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Convergencia con produccion: la tabla ya existia con el set minimo de columnas
-- (id, project_id, profile_id, name, filters, created_at), agregada fuera de banda.
-- CREATE TABLE IF NOT EXISTS es no-op sobre ella, asi que aseguramos las columnas
-- nuevas con ALTER idempotente para que produccion y un rebuild limpio converjan
-- al mismo shape (sin esto, la policy de is_shared y la API mejorada romperian en prod).
ALTER TABLE task_saved_views ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE task_saved_views ADD COLUMN IF NOT EXISTS sort       jsonb;
ALTER TABLE task_saved_views ADD COLUMN IF NOT EXISTS is_shared  boolean NOT NULL DEFAULT false;
ALTER TABLE task_saved_views ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE task_saved_views ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tsv_project ON task_saved_views(project_id);
CREATE INDEX IF NOT EXISTS idx_tsv_profile ON task_saved_views(profile_id);

-- updated_at automatico, misma funcion compartida que el resto del schema.
DROP TRIGGER IF EXISTS task_saved_views_updated_at ON task_saved_views;
CREATE TRIGGER task_saved_views_updated_at
  BEFORE UPDATE ON task_saved_views
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

COMMENT ON TABLE task_saved_views IS
  'Vistas guardadas (filtros + orden nombrados) por proyecto. Privadas por profile_id salvo is_shared = true.';

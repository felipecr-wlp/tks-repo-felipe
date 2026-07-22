-- ─────────────────────────────────────────────────────────────────────────────
-- task_templates: plantillas de tarea reutilizables ("Plantillas de tarea").
--
-- Contraparte a nivel TAREA de las plantillas de proyecto (src/lib/project-templates.ts):
-- un usuario guarda una tarea existente como plantilla (snapshot de descripcion,
-- prioridad, estimacion, story points y su checklist) y luego crea nuevas tareas
-- a partir de ella, prellenando esos campos y sembrando la checklist.
--
-- Ambito (project_id):
--   NULL      = plantilla disponible en TODO el workspace (cualquier miembro).
--   <uuid>    = plantilla del proyecto (solo miembros de ese proyecto).
--
-- Modelo de seguridad (identico a las tablas hermanas ancladas en proyecto, ej.
-- task_saved_views / task_attachments): la app lee/escribe por el admin client
-- (service_role) validando membresia en el handler. RLS es la red de seguridad
-- (defense in depth) para el cliente autenticado. Nunca se permite acceso
-- cross-workspace.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.task_templates (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  -- null = disponible en todo el workspace; si apunta a un proyecto, es del proyecto.
  project_id      uuid        REFERENCES projects(id) ON DELETE CASCADE,
  name            text        NOT NULL,                 -- nombre de la plantilla
  title           text        NOT NULL DEFAULT '',      -- titulo sugerido para la tarea
  description     text,
  priority        text        NOT NULL DEFAULT 'none'
                    CHECK (priority IN ('urgent','high','medium','low','none')),
  estimate_minutes integer,
  story_points    integer,
  -- array de { text } con los items de la checklist a sembrar al aplicar.
  checklist       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- visible para el proyecto / workspace (defensa contra plantillas borrador ocultas).
  is_shared       boolean     NOT NULL DEFAULT true,
  created_by      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_templates_workspace ON public.task_templates(workspace_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_project   ON public.task_templates(project_id);

ALTER TABLE public.task_templates ENABLE ROW LEVEL SECURITY;

-- updated_at automatico, misma funcion compartida que el resto del schema.
DROP TRIGGER IF EXISTS task_templates_updated_at ON public.task_templates;
CREATE TRIGGER task_templates_updated_at
  BEFORE UPDATE ON public.task_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── Policies (Postgres no tiene CREATE POLICY IF NOT EXISTS: DROP + CREATE) ────
-- Se usa (SELECT auth.uid()) para evitar el lint de rendimiento (initplan), igual
-- que en 20260714020000_rls_policies_orphan_tables.sql.

DROP POLICY IF EXISTS "task_templates_select" ON public.task_templates;
DROP POLICY IF EXISTS "task_templates_insert" ON public.task_templates;
DROP POLICY IF EXISTS "task_templates_update" ON public.task_templates;
DROP POLICY IF EXISTS "task_templates_delete" ON public.task_templates;

-- SELECT: plantillas de workspace (project_id null) visibles a miembros del
-- workspace; plantillas de proyecto visibles a miembros del proyecto. El dueño
-- siempre ve las suyas. Nunca cross-workspace.
CREATE POLICY "task_templates_select" ON public.task_templates FOR SELECT
  USING (
    created_by = (SELECT auth.uid())
    OR (
      project_id IS NULL
      AND workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = (SELECT auth.uid()))
    )
    OR (
      project_id IS NOT NULL
      AND project_id IN (SELECT project_id FROM project_members WHERE profile_id = (SELECT auth.uid()))
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

-- INSERT: el creador debe ser el usuario y debe pertenecer al workspace (o al
-- proyecto, si la plantilla es de proyecto). Nunca cross-workspace.
CREATE POLICY "task_templates_insert" ON public.task_templates FOR INSERT
  WITH CHECK (
    created_by = (SELECT auth.uid())
    AND workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = (SELECT auth.uid()))
    AND (
      project_id IS NULL
      OR project_id IN (SELECT project_id FROM project_members WHERE profile_id = (SELECT auth.uid()))
    )
  );

-- UPDATE/DELETE: el creador, o un manager del proyecto (plantillas de proyecto),
-- o un owner/admin del workspace. Consistente con como se gatean recursos ancla.
CREATE POLICY "task_templates_update" ON public.task_templates FOR UPDATE
  USING (
    created_by = (SELECT auth.uid())
    OR (
      project_id IS NOT NULL
      AND project_id IN (
        SELECT project_id FROM project_members
        WHERE profile_id = (SELECT auth.uid()) AND role = 'manager'
      )
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

CREATE POLICY "task_templates_delete" ON public.task_templates FOR DELETE
  USING (
    created_by = (SELECT auth.uid())
    OR (
      project_id IS NOT NULL
      AND project_id IN (
        SELECT project_id FROM project_members
        WHERE profile_id = (SELECT auth.uid()) AND role = 'manager'
      )
    )
    OR (SELECT org_role FROM profiles WHERE id = (SELECT auth.uid())) IN ('owner','admin')
  );

COMMENT ON TABLE public.task_templates IS
  'Plantillas de tarea reutilizables. project_id null = plantilla de todo el workspace; si apunta a un proyecto, es del proyecto. Snapshot de descripcion/prioridad/estimacion/story points + checklist.';

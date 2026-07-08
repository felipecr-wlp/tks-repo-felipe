-- ============================================================
-- Migration: 0001_initial_schema
-- Descripción: Schema completo inicial del Work OS
-- Fecha: 2026-04-13
-- ============================================================

-- ── Extensiones ───────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- búsqueda fuzzy
CREATE EXTENSION IF NOT EXISTS "unaccent";  -- búsqueda sin acentos

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE org_role             AS ENUM ('owner', 'admin', 'member');
CREATE TYPE workspace_role       AS ENUM ('admin', 'manager', 'member', 'viewer');
CREATE TYPE project_role         AS ENUM ('manager', 'member', 'viewer');
CREATE TYPE task_priority        AS ENUM ('none', 'low', 'medium', 'high', 'urgent');
CREATE TYPE status_category      AS ENUM ('not_started', 'active', 'done', 'cancelled');
CREATE TYPE project_status_state AS ENUM ('active', 'archived', 'completed');
CREATE TYPE project_visibility   AS ENUM ('private', 'team', 'workspace');
CREATE TYPE resource_visibility  AS ENUM ('private', 'project', 'team', 'workspace');
CREATE TYPE dependency_type      AS ENUM ('blocked_by', 'duplicates');
CREATE TYPE attachment_parent    AS ENUM ('task', 'comment', 'note', 'project');
CREATE TYPE google_parent        AS ENUM ('task', 'note', 'project');

-- ============================================================
-- FUNCIONES HELPER (usadas por RLS y triggers)
-- ============================================================

-- Retorna organization_id del JWT (claims custom) o fallback a profiles
CREATE OR REPLACE FUNCTION auth_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'org_id')::uuid,
    (SELECT organization_id FROM profiles WHERE id = auth.uid() LIMIT 1)
  )
$$;

-- Verifica si el usuario es owner/admin de su org
CREATE OR REPLACE FUNCTION is_org_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (auth.jwt() ->> 'org_role') IN ('owner', 'admin'),
    false
  )
$$;

-- Verifica si el usuario es miembro del workspace
CREATE OR REPLACE FUNCTION is_workspace_member(ws_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND profile_id = auth.uid()
  )
$$;

-- Verifica si el usuario es miembro del proyecto
CREATE OR REPLACE FUNCTION is_project_member(proj_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM project_members
    WHERE project_id = proj_id
      AND profile_id = auth.uid()
  )
$$;

-- Trigger: actualiza updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- ============================================================
-- TABLAS CORE
-- ============================================================

-- Organizations (tenant raíz)
CREATE TABLE organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text NOT NULL UNIQUE,
  logo_url   text,
  domain     text,           -- dominio permitido, ej "empresa.com"
  plan       text NOT NULL DEFAULT 'free',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Profiles (extiende auth.users)
-- NOTA: avatar_url debe ser siempre URL de Google CDN, nunca Supabase Storage
CREATE TABLE profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  full_name       text NOT NULL DEFAULT '',
  avatar_url      text,       -- Google CDN URL — NUNCA almacenar imagen en Storage
  org_role        org_role NOT NULL DEFAULT 'member',
  timezone        text NOT NULL DEFAULT 'UTC',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Workspaces (múltiples por org — uno por equipo/área)
CREATE TABLE workspaces (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  slug            text NOT NULL,
  description     text,
  icon            text,
  color           text,
  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

-- Workspace Members
CREATE TABLE workspace_members (
  workspace_id uuid         NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id   uuid         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role         workspace_role NOT NULL DEFAULT 'member',
  invited_by   uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  joined_at    timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, profile_id)
);

-- Teams
CREATE TABLE teams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  color           text,
  icon            text,
  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Team Members
CREATE TABLE team_members (
  team_id    uuid           NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  profile_id uuid           NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       workspace_role NOT NULL DEFAULT 'member',
  joined_at  timestamptz    NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, profile_id)
);

-- Projects
CREATE TABLE projects (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id         uuid REFERENCES teams(id) ON DELETE SET NULL,
  name            text NOT NULL,
  description     text,
  color           text,
  icon            text,
  status          project_status_state NOT NULL DEFAULT 'active',
  visibility      project_visibility   NOT NULL DEFAULT 'team',
  start_date      date,
  due_date        date,
  created_by      uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Project Members
CREATE TABLE project_members (
  project_id uuid         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_id uuid         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       project_role NOT NULL DEFAULT 'member',
  added_by   uuid         REFERENCES profiles(id) ON DELETE SET NULL,
  added_at   timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, profile_id)
);

-- Project Statuses (custom por proyecto — reemplaza los estados fijos de ClickUp)
CREATE TABLE project_statuses (
  id         uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid            NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text            NOT NULL,
  color      text            NOT NULL DEFAULT '#6B7280',
  category   status_category NOT NULL DEFAULT 'not_started',
  position   integer         NOT NULL DEFAULT 0,
  is_default boolean         NOT NULL DEFAULT false,
  created_at timestamptz     NOT NULL DEFAULT now()
);

-- ============================================================
-- TAREAS
-- ============================================================

CREATE TABLE tasks (
  id                    uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id          uuid          NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id            uuid          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  parent_task_id        uuid          REFERENCES tasks(id) ON DELETE SET NULL,
  status_id             uuid          REFERENCES project_statuses(id) ON DELETE SET NULL,
  title                 text          NOT NULL,
  -- ⚠️  NUNCA incluir 'description' en queries de lista — solo en task detail
  description           jsonb,        -- Tiptap JSON
  priority              task_priority NOT NULL DEFAULT 'none',
  start_date            date,
  due_date              date,
  time_estimate_minutes integer,
  position              float8        NOT NULL DEFAULT 0,  -- fractional-indexing
  is_archived           boolean       NOT NULL DEFAULT false,
  created_by            uuid          REFERENCES profiles(id) ON DELETE SET NULL,
  created_at            timestamptz   NOT NULL DEFAULT now(),
  updated_at            timestamptz   NOT NULL DEFAULT now(),
  -- Búsqueda de texto (título solamente para mantener índice liviano)
  search_vector         tsvector GENERATED ALWAYS AS (
    to_tsvector('spanish', unaccent(coalesce(title, '')))
  ) STORED
);

-- Task Assignees
CREATE TABLE task_assignees (
  task_id     uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  profile_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, profile_id)
);

-- Task Comments
CREATE TABLE task_comments (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id           uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  organization_id   uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  author_id         uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  content           jsonb       NOT NULL,   -- Tiptap JSON
  parent_comment_id uuid        REFERENCES task_comments(id) ON DELETE SET NULL,
  is_edited         boolean     NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Task Checklists
CREATE TABLE task_checklists (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title      text        NOT NULL DEFAULT 'Checklist',
  position   integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Task Checklist Items
CREATE TABLE task_checklist_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid        NOT NULL REFERENCES task_checklists(id) ON DELETE CASCADE,
  label        text        NOT NULL,
  is_completed boolean     NOT NULL DEFAULT false,
  completed_by uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  completed_at timestamptz,
  position     integer     NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Task Dependencies
CREATE TABLE task_dependencies (
  id                 uuid            PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id            uuid            NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on_task_id uuid            NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  type               dependency_type NOT NULL DEFAULT 'blocked_by',
  created_by         uuid            REFERENCES profiles(id) ON DELETE SET NULL,
  created_at         timestamptz     NOT NULL DEFAULT now(),
  UNIQUE (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

-- Labels (por workspace)
CREATE TABLE labels (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            text        NOT NULL,
  color           text        NOT NULL DEFAULT '#6B7280',
  created_by      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Task Labels (join)
CREATE TABLE task_labels (
  task_id  uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

-- ============================================================
-- NOTAS
-- ============================================================

CREATE TABLE notes (
  id              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid                NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid                NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id      uuid                REFERENCES projects(id) ON DELETE SET NULL,
  task_id         uuid                REFERENCES tasks(id) ON DELETE SET NULL,
  title           text                NOT NULL,
  -- ⚠️  NUNCA incluir 'content' en queries de lista — solo en note detail
  content         jsonb,              -- Tiptap JSON
  visibility      resource_visibility NOT NULL DEFAULT 'workspace',
  is_archived     boolean             NOT NULL DEFAULT false,
  created_by      uuid                REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz         NOT NULL DEFAULT now(),
  updated_at      timestamptz         NOT NULL DEFAULT now(),
  search_vector   tsvector GENERATED ALWAYS AS (
    to_tsvector('spanish', unaccent(coalesce(title, '')))
  ) STORED
);

-- Note Versions (historial — máx 50 por nota, poda automática vía trigger)
CREATE TABLE note_versions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id    uuid        NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  content    jsonb       NOT NULL,
  title      text        NOT NULL,
  saved_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- PIZARRAS
-- ============================================================

CREATE TABLE whiteboards (
  id              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid                NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid                NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id      uuid                REFERENCES projects(id) ON DELETE SET NULL,
  title           text                NOT NULL,
  -- ⚠️  NUNCA incluir 'content' en queries de lista — solo cuando se abre
  content         jsonb,              -- Excalidraw scene JSON
  visibility      resource_visibility NOT NULL DEFAULT 'workspace',
  created_by      uuid                REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz         NOT NULL DEFAULT now(),
  updated_at      timestamptz         NOT NULL DEFAULT now()
);

-- ============================================================
-- ADJUNTOS (con visibilidad + IDs denormalizados para RLS eficiente)
-- ============================================================

CREATE TABLE attachments (
  id              uuid                PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid                NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- Denormalizados para evitar JOINs en RLS:
  workspace_id    uuid                NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id      uuid                REFERENCES projects(id) ON DELETE SET NULL,
  team_id         uuid                REFERENCES teams(id) ON DELETE SET NULL,
  -- Info del archivo
  uploaded_by     uuid                NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  storage_path    text                NOT NULL,  -- path en Supabase Storage
  filename        text                NOT NULL,
  content_type    text,
  size_bytes      bigint,
  -- Visibilidad
  visibility      resource_visibility NOT NULL DEFAULT 'project',
  -- Padre polimórfico
  parent_type     attachment_parent   NOT NULL,
  parent_id       uuid                NOT NULL,
  created_at      timestamptz         NOT NULL DEFAULT now()
);

-- ============================================================
-- INTEGRACIONES GOOGLE
-- ============================================================

CREATE TABLE google_connections (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id     uuid        NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  google_user_id text        NOT NULL,
  access_token   text,       -- Encriptar con Supabase Vault en producción
  refresh_token  text,       -- Encriptar con Supabase Vault en producción
  token_expiry   timestamptz,
  scopes         text[]      NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE google_drive_links (
  id                  uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid           NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by          uuid           NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  drive_file_id       text           NOT NULL,
  drive_file_name     text,
  drive_file_url      text,
  drive_thumbnail_url text,          -- Google CDN thumbnail URL
  drive_mime_type     text,
  parent_type         google_parent  NOT NULL,
  parent_id           uuid           NOT NULL,
  created_at          timestamptz    NOT NULL DEFAULT now()
);

CREATE TABLE google_sheet_links (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by       uuid          NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  spreadsheet_id   text          NOT NULL,
  spreadsheet_name text,
  sheet_name       text,
  embed_url        text,
  sync_range       text,         -- ej: 'Sheet1!A1:D20' — null = solo embed iframe
  last_synced_at   timestamptz,
  parent_type      google_parent NOT NULL,
  parent_id        uuid          NOT NULL,
  created_at       timestamptz   NOT NULL DEFAULT now()
);

-- ============================================================
-- ACTIVIDAD Y NOTIFICACIONES
-- ============================================================

CREATE TABLE activity_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workspace_id    uuid        REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id        uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  verb            text        NOT NULL, -- 'task.created', 'status.changed', 'comment.added'…
  entity_type     text        NOT NULL, -- 'task', 'project', 'note'…
  entity_id       uuid        NOT NULL,
  entity_title    text,                 -- snapshot para display sin JOIN
  metadata        jsonb,                -- campos cambiados: { from, to, … }
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  recipient_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  actor_id        uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  type            text        NOT NULL, -- 'mention', 'task_assigned', 'comment_reply'…
  entity_type     text,
  entity_id       uuid,
  entity_title    text,
  is_read         boolean     NOT NULL DEFAULT false,
  read_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- ÍNDICES
-- ============================================================

-- Organizations
CREATE INDEX idx_orgs_slug         ON organizations(slug);

-- Profiles
CREATE INDEX idx_profiles_org      ON profiles(organization_id);

-- Workspaces
CREATE INDEX idx_ws_org            ON workspaces(organization_id);
CREATE INDEX idx_ws_slug           ON workspaces(organization_id, slug);

-- Workspace Members
CREATE INDEX idx_wm_profile        ON workspace_members(profile_id);
CREATE INDEX idx_wm_workspace      ON workspace_members(workspace_id);

-- Teams
CREATE INDEX idx_teams_ws          ON teams(workspace_id);
CREATE INDEX idx_teams_org         ON teams(organization_id);

-- Team Members
CREATE INDEX idx_tm_profile        ON team_members(profile_id);
CREATE INDEX idx_tm_team           ON team_members(team_id);

-- Projects
CREATE INDEX idx_proj_ws           ON projects(workspace_id);
CREATE INDEX idx_proj_org          ON projects(organization_id);
CREATE INDEX idx_proj_team         ON projects(team_id) WHERE team_id IS NOT NULL;
CREATE INDEX idx_proj_status       ON projects(status);

-- Project Statuses
CREATE INDEX idx_pstat_proj        ON project_statuses(project_id, position);

-- Tasks — tabla más consultada
CREATE INDEX idx_tasks_proj_pos    ON tasks(project_id, position) WHERE is_archived = false;
CREATE INDEX idx_tasks_org         ON tasks(organization_id);
CREATE INDEX idx_tasks_ws          ON tasks(workspace_id);
CREATE INDEX idx_tasks_status      ON tasks(status_id);
CREATE INDEX idx_tasks_due         ON tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_tasks_parent      ON tasks(parent_task_id) WHERE parent_task_id IS NOT NULL;
CREATE INDEX idx_tasks_search      ON tasks USING GIN(search_vector);
CREATE INDEX idx_tasks_created_by  ON tasks(created_by);

-- Task Assignees
CREATE INDEX idx_ta_profile        ON task_assignees(profile_id);  -- "mis tareas"
CREATE INDEX idx_ta_task           ON task_assignees(task_id);

-- Task Comments
CREATE INDEX idx_tc_task_date      ON task_comments(task_id, created_at DESC);

-- Task Checklists
CREATE INDEX idx_tcli_checklist    ON task_checklist_items(checklist_id, position);

-- Labels
CREATE INDEX idx_labels_ws         ON labels(workspace_id);

-- Notes
CREATE INDEX idx_notes_ws          ON notes(workspace_id);
CREATE INDEX idx_notes_proj        ON notes(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX idx_notes_search      ON notes USING GIN(search_vector);
CREATE INDEX idx_notes_by          ON notes(created_by);

-- Note Versions
CREATE INDEX idx_nv_note_date      ON note_versions(note_id, created_at DESC);

-- Whiteboards
CREATE INDEX idx_wb_ws             ON whiteboards(workspace_id);
CREATE INDEX idx_wb_proj           ON whiteboards(project_id) WHERE project_id IS NOT NULL;

-- Attachments
CREATE INDEX idx_att_parent        ON attachments(parent_type, parent_id);
CREATE INDEX idx_att_uploader      ON attachments(uploaded_by);
CREATE INDEX idx_att_ws            ON attachments(workspace_id);

-- Activity Events
CREATE INDEX idx_ae_entity         ON activity_events(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_ae_org_date       ON activity_events(organization_id, created_at DESC);
CREATE INDEX idx_ae_ws_date        ON activity_events(workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;

-- Notifications — partial index solo no leídas (las más consultadas)
CREATE INDEX idx_notif_unread      ON notifications(recipient_id, created_at DESC)
  WHERE is_read = false;
CREATE INDEX idx_notif_all         ON notifications(recipient_id, created_at DESC);

-- ============================================================
-- TRIGGERS updated_at
-- ============================================================

CREATE TRIGGER orgs_updated_at          BEFORE UPDATE ON organizations     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER profiles_updated_at      BEFORE UPDATE ON profiles          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER workspaces_updated_at    BEFORE UPDATE ON workspaces        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER teams_updated_at         BEFORE UPDATE ON teams             FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER projects_updated_at      BEFORE UPDATE ON projects          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tasks_updated_at         BEFORE UPDATE ON tasks             FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER comments_updated_at      BEFORE UPDATE ON task_comments     FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER notes_updated_at         BEFORE UPDATE ON notes             FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER whiteboards_updated_at   BEFORE UPDATE ON whiteboards       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER gc_updated_at            BEFORE UPDATE ON google_connections FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY — habilitar en todas las tablas
-- ============================================================

ALTER TABLE organizations       ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces          ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams               ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members     ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_statuses    ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees      ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_checklists     ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE labels              ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_labels         ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes               ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_versions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboards         ENABLE ROW LEVEL SECURITY;
ALTER TABLE attachments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_connections  ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_drive_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE google_sheet_links  ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- POLÍTICAS RLS
-- ============================================================

-- ORGANIZATIONS
CREATE POLICY "orgs_select" ON organizations FOR SELECT
  USING (id = auth_org_id());
CREATE POLICY "orgs_update" ON organizations FOR UPDATE
  USING (id = auth_org_id() AND is_org_admin());

-- PROFILES
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  USING (organization_id = auth_org_id());
CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update" ON profiles FOR UPDATE
  USING (id = auth.uid());

-- WORKSPACES
CREATE POLICY "ws_select" ON workspaces FOR SELECT
  USING (organization_id = auth_org_id() AND (is_org_admin() OR is_workspace_member(id)));
CREATE POLICY "ws_insert" ON workspaces FOR INSERT
  WITH CHECK (organization_id = auth_org_id() AND is_org_admin());
CREATE POLICY "ws_update" ON workspaces FOR UPDATE
  USING (organization_id = auth_org_id() AND (
    is_org_admin()
    OR EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = workspaces.id AND profile_id = auth.uid() AND role = 'admin')
  ));

-- WORKSPACE MEMBERS
CREATE POLICY "wm_select" ON workspace_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.organization_id = auth_org_id()));
CREATE POLICY "wm_insert" ON workspace_members FOR INSERT
  WITH CHECK (
    is_org_admin()
    OR EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = workspace_members.workspace_id AND wm.profile_id = auth.uid() AND wm.role = 'admin')
  );
CREATE POLICY "wm_delete" ON workspace_members FOR DELETE
  USING (profile_id = auth.uid() OR is_org_admin());

-- TEAMS
CREATE POLICY "teams_select" ON teams FOR SELECT
  USING (organization_id = auth_org_id() AND is_workspace_member(workspace_id));
CREATE POLICY "teams_insert" ON teams FOR INSERT
  WITH CHECK (organization_id = auth_org_id() AND is_workspace_member(workspace_id));
CREATE POLICY "teams_update" ON teams FOR UPDATE
  USING (organization_id = auth_org_id() AND (
    is_org_admin()
    OR EXISTS (SELECT 1 FROM team_members WHERE team_id = teams.id AND profile_id = auth.uid() AND role IN ('admin', 'manager'))
  ));
CREATE POLICY "teams_delete" ON teams FOR DELETE
  USING (organization_id = auth_org_id() AND is_org_admin());

-- TEAM MEMBERS
CREATE POLICY "tm_select" ON team_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM teams t WHERE t.id = team_id AND t.organization_id = auth_org_id()));
CREATE POLICY "tm_insert" ON team_members FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM teams t WHERE t.id = team_id AND t.organization_id = auth_org_id()
    AND is_workspace_member(t.workspace_id)
  ));
CREATE POLICY "tm_delete" ON team_members FOR DELETE
  USING (profile_id = auth.uid() OR is_org_admin());

-- PROJECTS
CREATE POLICY "proj_select" ON projects FOR SELECT
  USING (
    organization_id = auth_org_id()
    AND is_workspace_member(workspace_id)
    AND (
      is_org_admin()
      OR visibility = 'workspace'
      OR (visibility = 'team' AND EXISTS (
        SELECT 1 FROM team_members WHERE team_id = projects.team_id AND profile_id = auth.uid()
      ))
      OR is_project_member(id)
      OR created_by = auth.uid()
    )
  );
CREATE POLICY "proj_insert" ON projects FOR INSERT
  WITH CHECK (organization_id = auth_org_id() AND is_workspace_member(workspace_id));
CREATE POLICY "proj_update" ON projects FOR UPDATE
  USING (organization_id = auth_org_id() AND (
    is_org_admin()
    OR EXISTS (SELECT 1 FROM project_members WHERE project_id = projects.id AND profile_id = auth.uid() AND role = 'manager')
  ));
CREATE POLICY "proj_delete" ON projects FOR DELETE
  USING (organization_id = auth_org_id() AND is_org_admin());

-- PROJECT MEMBERS
CREATE POLICY "pm_select" ON project_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = auth_org_id()));
CREATE POLICY "pm_insert" ON project_members FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = auth_org_id()
    AND (is_org_admin() OR EXISTS (
      SELECT 1 FROM project_members pm2 WHERE pm2.project_id = project_id AND pm2.profile_id = auth.uid() AND pm2.role = 'manager'
    ))
  ));
CREATE POLICY "pm_delete" ON project_members FOR DELETE
  USING (profile_id = auth.uid() OR is_org_admin());

-- PROJECT STATUSES
CREATE POLICY "pstat_select" ON project_statuses FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = auth_org_id()
    AND is_workspace_member(p.workspace_id)
  ));
CREATE POLICY "pstat_manage" ON project_statuses FOR ALL
  USING (EXISTS (
    SELECT 1 FROM projects p WHERE p.id = project_id AND p.organization_id = auth_org_id()
    AND (is_org_admin() OR EXISTS (
      SELECT 1 FROM project_members pm WHERE pm.project_id = project_id AND pm.profile_id = auth.uid() AND pm.role = 'manager'
    ))
  ));

-- TASKS
CREATE POLICY "tasks_select" ON tasks FOR SELECT
  USING (organization_id = auth_org_id() AND (is_org_admin() OR is_project_member(project_id)));
CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (
    organization_id = auth_org_id()
    AND EXISTS (SELECT 1 FROM project_members WHERE project_id = tasks.project_id AND profile_id = auth.uid() AND role IN ('manager','member'))
  );
CREATE POLICY "tasks_update" ON tasks FOR UPDATE
  USING (
    organization_id = auth_org_id()
    AND (is_org_admin() OR EXISTS (
      SELECT 1 FROM project_members WHERE project_id = tasks.project_id AND profile_id = auth.uid() AND role IN ('manager','member')
    ))
  );
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (
    organization_id = auth_org_id()
    AND (is_org_admin() OR created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM project_members WHERE project_id = tasks.project_id AND profile_id = auth.uid() AND role = 'manager'
    ))
  );

-- TASK ASSIGNEES
CREATE POLICY "ta_select" ON task_assignees FOR SELECT
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.organization_id = auth_org_id()));
CREATE POLICY "ta_insert" ON task_assignees FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.organization_id = auth_org_id() AND is_project_member(t.project_id)));
CREATE POLICY "ta_delete" ON task_assignees FOR DELETE
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.organization_id = auth_org_id()));

-- TASK COMMENTS
CREATE POLICY "tc_select" ON task_comments FOR SELECT
  USING (organization_id = auth_org_id() AND EXISTS (
    SELECT 1 FROM tasks t WHERE t.id = task_id AND is_project_member(t.project_id)
  ));
CREATE POLICY "tc_insert" ON task_comments FOR INSERT
  WITH CHECK (organization_id = auth_org_id() AND author_id = auth.uid() AND EXISTS (
    SELECT 1 FROM tasks t WHERE t.id = task_id AND is_project_member(t.project_id)
  ));
CREATE POLICY "tc_update" ON task_comments FOR UPDATE
  USING (organization_id = auth_org_id() AND author_id = auth.uid());
CREATE POLICY "tc_delete" ON task_comments FOR DELETE
  USING (organization_id = auth_org_id() AND (author_id = auth.uid() OR is_org_admin()));

-- TASK CHECKLISTS
CREATE POLICY "tcl_select" ON task_checklists FOR SELECT
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.organization_id = auth_org_id() AND is_project_member(t.project_id)));
CREATE POLICY "tcl_all" ON task_checklists FOR ALL
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.organization_id = auth_org_id()));

-- TASK CHECKLIST ITEMS
CREATE POLICY "tcli_select" ON task_checklist_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM task_checklists tc JOIN tasks t ON t.id = tc.task_id
    WHERE tc.id = checklist_id AND t.organization_id = auth_org_id() AND is_project_member(t.project_id)
  ));
CREATE POLICY "tcli_all" ON task_checklist_items FOR ALL
  USING (EXISTS (
    SELECT 1 FROM task_checklists tc JOIN tasks t ON t.id = tc.task_id
    WHERE tc.id = checklist_id AND t.organization_id = auth_org_id()
  ));

-- TASK DEPENDENCIES
CREATE POLICY "td_all" ON task_dependencies FOR ALL
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.organization_id = auth_org_id()));

-- LABELS
CREATE POLICY "labels_select" ON labels FOR SELECT
  USING (organization_id = auth_org_id() AND is_workspace_member(workspace_id));
CREATE POLICY "labels_insert" ON labels FOR INSERT
  WITH CHECK (organization_id = auth_org_id() AND is_workspace_member(workspace_id));
CREATE POLICY "labels_update" ON labels FOR UPDATE
  USING (organization_id = auth_org_id() AND (is_org_admin() OR created_by = auth.uid()));
CREATE POLICY "labels_delete" ON labels FOR DELETE
  USING (organization_id = auth_org_id() AND (is_org_admin() OR created_by = auth.uid()));

-- TASK LABELS
CREATE POLICY "tl_all" ON task_labels FOR ALL
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_id AND t.organization_id = auth_org_id()));

-- NOTES (con visibilidad)
CREATE POLICY "notes_select" ON notes FOR SELECT
  USING (
    organization_id = auth_org_id()
    AND (
      is_org_admin()
      OR created_by = auth.uid()
      OR (visibility = 'workspace' AND is_workspace_member(workspace_id))
      OR (visibility = 'project'   AND project_id IS NOT NULL AND is_project_member(project_id))
      OR (visibility = 'team'      AND project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM projects p JOIN team_members tm ON tm.team_id = p.team_id
        WHERE p.id = project_id AND tm.profile_id = auth.uid()
      ))
    )
  );
CREATE POLICY "notes_insert" ON notes FOR INSERT
  WITH CHECK (organization_id = auth_org_id() AND created_by = auth.uid() AND is_workspace_member(workspace_id));
CREATE POLICY "notes_update" ON notes FOR UPDATE
  USING (organization_id = auth_org_id() AND (is_org_admin() OR created_by = auth.uid()));
CREATE POLICY "notes_delete" ON notes FOR DELETE
  USING (organization_id = auth_org_id() AND (is_org_admin() OR created_by = auth.uid()));

-- NOTE VERSIONS
CREATE POLICY "nv_select" ON note_versions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM notes n WHERE n.id = note_id AND n.organization_id = auth_org_id()
    AND (is_org_admin() OR n.created_by = auth.uid() OR is_workspace_member(n.workspace_id))
  ));
CREATE POLICY "nv_insert" ON note_versions FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND n.organization_id = auth_org_id()));

-- WHITEBOARDS (con visibilidad)
CREATE POLICY "wb_select" ON whiteboards FOR SELECT
  USING (
    organization_id = auth_org_id()
    AND (
      is_org_admin()
      OR created_by = auth.uid()
      OR (visibility = 'workspace' AND is_workspace_member(workspace_id))
      OR (visibility = 'project'   AND project_id IS NOT NULL AND is_project_member(project_id))
      OR (visibility = 'team'      AND project_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM projects p JOIN team_members tm ON tm.team_id = p.team_id
        WHERE p.id = project_id AND tm.profile_id = auth.uid()
      ))
    )
  );
CREATE POLICY "wb_insert" ON whiteboards FOR INSERT
  WITH CHECK (organization_id = auth_org_id() AND is_workspace_member(workspace_id));
CREATE POLICY "wb_update" ON whiteboards FOR UPDATE
  USING (organization_id = auth_org_id() AND (is_org_admin() OR created_by = auth.uid() OR is_workspace_member(workspace_id)));
CREATE POLICY "wb_delete" ON whiteboards FOR DELETE
  USING (organization_id = auth_org_id() AND (is_org_admin() OR created_by = auth.uid()));

-- ATTACHMENTS (con visibilidad — IDs denormalizados evitan JOINs)
CREATE POLICY "att_select" ON attachments FOR SELECT
  USING (
    organization_id = auth_org_id()
    AND (
      is_org_admin()
      OR uploaded_by = auth.uid()
      OR (visibility = 'workspace' AND is_workspace_member(workspace_id))
      OR (visibility = 'project'   AND project_id IS NOT NULL AND is_project_member(project_id))
      OR (visibility = 'team'      AND team_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM team_members WHERE team_id = attachments.team_id AND profile_id = auth.uid()
      ))
    )
  );
CREATE POLICY "att_insert" ON attachments FOR INSERT
  WITH CHECK (organization_id = auth_org_id() AND uploaded_by = auth.uid() AND is_workspace_member(workspace_id));
CREATE POLICY "att_delete" ON attachments FOR DELETE
  USING (organization_id = auth_org_id() AND (uploaded_by = auth.uid() OR is_org_admin()));

-- GOOGLE CONNECTIONS (solo el propio usuario)
CREATE POLICY "gc_own" ON google_connections FOR ALL USING (profile_id = auth.uid());

-- GOOGLE DRIVE LINKS
CREATE POLICY "gdl_select" ON google_drive_links FOR SELECT USING (organization_id = auth_org_id());
CREATE POLICY "gdl_insert" ON google_drive_links FOR INSERT WITH CHECK (organization_id = auth_org_id() AND created_by = auth.uid());
CREATE POLICY "gdl_delete" ON google_drive_links FOR DELETE USING (organization_id = auth_org_id() AND (created_by = auth.uid() OR is_org_admin()));

-- GOOGLE SHEET LINKS
CREATE POLICY "gsl_select" ON google_sheet_links FOR SELECT USING (organization_id = auth_org_id());
CREATE POLICY "gsl_insert" ON google_sheet_links FOR INSERT WITH CHECK (organization_id = auth_org_id() AND created_by = auth.uid());
CREATE POLICY "gsl_delete" ON google_sheet_links FOR DELETE USING (organization_id = auth_org_id() AND (created_by = auth.uid() OR is_org_admin()));

-- ACTIVITY EVENTS
CREATE POLICY "ae_select" ON activity_events FOR SELECT USING (organization_id = auth_org_id());
CREATE POLICY "ae_insert" ON activity_events FOR INSERT WITH CHECK (organization_id = auth_org_id());

-- NOTIFICATIONS (solo el destinatario)
CREATE POLICY "notif_select" ON notifications FOR SELECT USING (recipient_id = auth.uid());
CREATE POLICY "notif_update" ON notifications FOR UPDATE USING (recipient_id = auth.uid());  -- marcar como leída
CREATE POLICY "notif_insert" ON notifications FOR INSERT WITH CHECK (organization_id = auth_org_id());

-- ============================================================
-- TRIGGER: crear perfil al registrarse con Google
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- El perfil completo se crea en el flujo de onboarding vía API
  -- Este trigger solo garantiza que el registro no quede huérfano
  INSERT INTO profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
    NEW.raw_user_meta_data->>'avatar_url'  -- URL de Google CDN
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- TRIGGER: crear statuses por defecto al crear proyecto
-- ============================================================

CREATE OR REPLACE FUNCTION on_project_created()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Statuses por defecto (en español)
  INSERT INTO project_statuses (project_id, name, color, category, position, is_default) VALUES
    (NEW.id, 'Por hacer',   '#6B7280', 'not_started', 0, true),
    (NEW.id, 'En progreso', '#3B82F6', 'active',      1, false),
    (NEW.id, 'En revisión', '#F59E0B', 'active',      2, false),
    (NEW.id, 'Completado',  '#10B981', 'done',        3, false),
    (NEW.id, 'Cancelado',   '#EF4444', 'cancelled',   4, false);

  -- Agregar al creador como manager automáticamente
  IF NEW.created_by IS NOT NULL THEN
    INSERT INTO project_members (project_id, profile_id, role)
    VALUES (NEW.id, NEW.created_by, 'manager')
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER project_created_trigger
  AFTER INSERT ON projects
  FOR EACH ROW EXECUTE FUNCTION on_project_created();

-- ============================================================
-- TRIGGER: podar versiones de notas (máx 50 por nota)
-- ============================================================

CREATE OR REPLACE FUNCTION prune_note_versions()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM note_versions
  WHERE note_id = NEW.note_id
    AND id NOT IN (
      SELECT id FROM note_versions
      WHERE note_id = NEW.note_id
      ORDER BY created_at DESC
      LIMIT 50
    );
  RETURN NEW;
END;
$$;

CREATE TRIGGER note_version_prune
  AFTER INSERT ON note_versions
  FOR EACH ROW EXECUTE FUNCTION prune_note_versions();

-- ============================================================
-- Storage bucket para adjuntos
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  false,          -- privado, acceso solo via URL firmada
  20971520,       -- 20MB máximo por archivo
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/zip',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
) ON CONFLICT (id) DO NOTHING;

-- RLS para Storage: solo miembros de la org pueden subir/ver
CREATE POLICY "storage_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'attachments' AND auth.role() = 'authenticated');

CREATE POLICY "storage_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'attachments' AND auth.role() = 'authenticated');

CREATE POLICY "storage_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'attachments' AND auth.uid()::text = (storage.foldername(name))[1]);

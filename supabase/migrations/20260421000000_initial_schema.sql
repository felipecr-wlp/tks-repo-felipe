-- ============================================================
-- Migration: 0001_initial_schema
-- Descripción: Schema inicial completo — Work OS
--              Tablas, RLS, índices, triggers, funciones helper
--              y JWT Custom Claims hook
-- Fecha: 2026-04-21
-- ============================================================


-- ════════════════════════════════════════════════════════════
-- 0. EXTENSIONES
-- ════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pg_trgm";    -- búsqueda trigram (search)


-- ════════════════════════════════════════════════════════════
-- 1. FUNCIONES HELPER INDEPENDIENTES
-- ════════════════════════════════════════════════════════════

-- updated_at automático para todas las tablas
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


-- ════════════════════════════════════════════════════════════
-- 2. TABLAS (orden de dependencias, sin políticas todavía)
-- ════════════════════════════════════════════════════════════

-- ─── organizations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  slug       text        NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;

-- ─── profiles (extiende auth.users) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id           uuid  PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        text,
  display_name text,
  avatar_url   text,              -- URL de Google CDN — nunca almacenar en Storage
  org_id       uuid  REFERENCES organizations(id) ON DELETE SET NULL,
  org_role     text  NOT NULL DEFAULT 'member'
                     CHECK (org_role IN ('owner','admin','member')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- ─── org_members ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_members (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id uuid        NOT NULL REFERENCES profiles(id)      ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'member'
                         CHECK (role IN ('owner','admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, profile_id)
);
ALTER TABLE org_members ENABLE ROW LEVEL SECURITY;

-- ─── workspaces ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspaces (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        text        NOT NULL,
  slug        text        NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- ─── workspace_members ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workspace_members (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id   uuid        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  role         text        NOT NULL DEFAULT 'member'
                           CHECK (role IN ('admin','manager','member','viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, profile_id)
);
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- ─── teams ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS teams (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  slug         text        NOT NULL,
  description  text,
  created_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;

-- ─── team_members ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_members (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid        NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
  profile_id uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'member'
                         CHECK (role IN ('admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, profile_id)
);
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;

-- ─── projects ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS projects (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid        NOT NULL REFERENCES teams(id)      ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  slug         text        NOT NULL,
  icon         text        DEFAULT '📋',
  description  text,
  status       text        NOT NULL DEFAULT 'active'
                           CHECK (status IN ('active','on_hold','archived')),
  is_archived  boolean     NOT NULL DEFAULT false,
  created_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (team_id, slug)
);
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

-- ─── project_members ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_members (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  profile_id uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       text        NOT NULL DEFAULT 'member'
                         CHECK (role IN ('manager','member','viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, profile_id)
);
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;

-- ─── task_statuses (custom por proyecto) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_statuses (
  id         uuid     PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid     NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text     NOT NULL,
  color      text,                        -- hex color e.g. '#4f46e5'
  category   text     NOT NULL DEFAULT 'todo'
                      CHECK (category IN ('todo','in_progress','done','cancelled')),
  position   smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE task_statuses ENABLE ROW LEVEL SECURITY;

-- ─── tasks ───────────────────────────────────────────────────────────────────
-- NOTA: assignee_id y created_by tienen nombres de FK explícitos para los
--       join hints de Supabase: profiles!tasks_assignee_id_fkey
--                               profiles!tasks_created_by_fkey
CREATE TABLE IF NOT EXISTS tasks (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title        text        NOT NULL,
  description  text,                      -- Tiptap JSON serializado como string
  status_id    uuid        REFERENCES task_statuses(id) ON DELETE SET NULL,
  priority     text        NOT NULL DEFAULT 'none'
                           CHECK (priority IN ('urgent','high','medium','low','none')),
  assignee_id  uuid        CONSTRAINT tasks_assignee_id_fkey
                           REFERENCES profiles(id) ON DELETE SET NULL,
  created_by   uuid        CONSTRAINT tasks_created_by_fkey
                           REFERENCES profiles(id) ON DELETE SET NULL,
  due_date     timestamptz,
  sort_order   text        NOT NULL,      -- fractional indexing (lexicográfico)
  is_archived  boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- ─── task_comments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_comments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid        NOT NULL REFERENCES tasks(id)      ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id    uuid        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  content      text        NOT NULL,      -- Tiptap JSON como string
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;

-- ─── task_checklists ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_checklists (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id    uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  title      text        NOT NULL DEFAULT 'Lista de verificación',
  position   smallint    NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE task_checklists ENABLE ROW LEVEL SECURITY;

-- ─── task_checklist_items ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_checklist_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id uuid        NOT NULL REFERENCES task_checklists(id) ON DELETE CASCADE,
  task_id      uuid        NOT NULL REFERENCES tasks(id)            ON DELETE CASCADE,
  title        text        NOT NULL,
  is_checked   boolean     NOT NULL DEFAULT false,
  position     smallint    NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE task_checklist_items ENABLE ROW LEVEL SECURITY;

-- ─── task_dependencies ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_dependencies (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  depends_on   uuid        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, depends_on),
  CHECK (task_id <> depends_on)
);
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;

-- ─── labels (por proyecto) ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS labels (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text        NOT NULL,
  color        text        NOT NULL DEFAULT '#6b7280',
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;

-- ─── task_labels (junction) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS task_labels (
  task_id    uuid NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
  label_id   uuid NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (task_id, label_id)
);
ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;

-- ─── activity_events ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS activity_events (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   uuid        REFERENCES projects(id) ON DELETE CASCADE,
  subject_id   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  verb         text        NOT NULL,
  object_type  text        NOT NULL,
  object_id    uuid        NOT NULL,
  object_title text,
  metadata     jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE activity_events ENABLE ROW LEVEL SECURITY;

-- ─── notifications ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  subject_id   uuid        REFERENCES profiles(id) ON DELETE SET NULL,  -- actor
  type         text        NOT NULL,
  object_type  text,
  object_id    uuid,
  object_title text,
  is_read      boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ─── attachments (con visibility) ────────────────────────────────────────────
-- workspace_id/project_id/team_id denormalizados para RLS sin joins costosos
CREATE TABLE IF NOT EXISTS attachments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   uuid        REFERENCES projects(id) ON DELETE CASCADE,
  team_id      uuid        REFERENCES teams(id)    ON DELETE CASCADE,
  name         text        NOT NULL,
  url          text        NOT NULL,
  mime_type    text,
  size         bigint,
  visibility   text        NOT NULL DEFAULT 'project'
                           CHECK (visibility IN ('private','project','team','workspace')),
  created_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;

-- ─── notes (con visibility) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   uuid        REFERENCES projects(id) ON DELETE CASCADE,
  title        text        NOT NULL DEFAULT 'Sin título',
  content      text,                      -- Tiptap JSON serializado
  visibility   text        NOT NULL DEFAULT 'project'
                           CHECK (visibility IN ('private','project','team','workspace')),
  created_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notes ENABLE ROW LEVEL SECURITY;

-- ─── whiteboards (con visibility) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS whiteboards (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id   uuid        REFERENCES projects(id) ON DELETE CASCADE,
  title        text        NOT NULL DEFAULT 'Pizarra sin título',
  content      text,                      -- Excalidraw JSON serializado
  visibility   text        NOT NULL DEFAULT 'project'
                           CHECK (visibility IN ('private','project','team','workspace')),
  created_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE whiteboards ENABLE ROW LEVEL SECURITY;


-- ════════════════════════════════════════════════════════════
-- 3. FUNCIONES QUE DEPENDEN DE TABLAS
-- ════════════════════════════════════════════════════════════

-- auth_org_id(): usada en TODAS las políticas RLS para aislamiento de org
-- SECURITY DEFINER para evitar RLS recursivo en profiles
CREATE OR REPLACE FUNCTION auth_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.profiles WHERE id = auth.uid()
$$;

-- Auto-crear profile cuando el usuario hace signup con Google OAuth
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1)
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- JWT Custom Claims Hook
-- Registrar en: Supabase Dashboard → Authentication → Hooks → Custom Access Token
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  claims        jsonb;
  v_org_id      uuid;
  v_org_role    text;
  v_ws_ids      uuid[];
BEGIN
  SELECT org_id, org_role
    INTO v_org_id, v_org_role
    FROM public.profiles
   WHERE id = (event->>'user_id')::uuid;

  SELECT ARRAY_AGG(workspace_id)
    INTO v_ws_ids
    FROM public.workspace_members
   WHERE profile_id = (event->>'user_id')::uuid;

  claims := event->'claims';

  IF v_org_id IS NOT NULL THEN
    claims := jsonb_set(claims, '{org_id}',   to_jsonb(v_org_id::text));
    claims := jsonb_set(claims, '{org_role}', to_jsonb(v_org_role));
  END IF;

  IF v_ws_ids IS NOT NULL THEN
    claims := jsonb_set(claims, '{workspace_ids}', to_jsonb(v_ws_ids));
  END IF;

  RETURN jsonb_set(event, '{claims}', claims);
END;
$$;

GRANT  EXECUTE ON FUNCTION public.custom_access_token_hook TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook FROM authenticated, anon, public;


-- ════════════════════════════════════════════════════════════
-- 4. POLÍTICAS RLS (todas las tablas ya existen)
-- ════════════════════════════════════════════════════════════

-- ─── organizations ───────────────────────────────────────────────────────────
-- Solo la propia org es visible; insert/delete solo vía service_role (onboarding)
CREATE POLICY "organizations_select" ON organizations FOR SELECT
  USING (id = auth_org_id());

CREATE POLICY "organizations_update" ON organizations FOR UPDATE
  USING (
    id = auth_org_id()
    AND (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── profiles ────────────────────────────────────────────────────────────────
-- Ver: perfiles de la misma org + propio
CREATE POLICY "profiles_select" ON profiles FOR SELECT
  USING (
    id = auth.uid()
    OR org_id = auth_org_id()
  );

-- Solo actualizar el propio perfil
CREATE POLICY "profiles_update" ON profiles FOR UPDATE
  USING  (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Insert solo vía handle_new_user() (SECURITY DEFINER)
CREATE POLICY "profiles_insert" ON profiles FOR INSERT
  WITH CHECK (id = auth.uid());

-- ─── org_members ─────────────────────────────────────────────────────────────
CREATE POLICY "org_members_select" ON org_members FOR SELECT
  USING (org_id = auth_org_id());

CREATE POLICY "org_members_insert" ON org_members FOR INSERT
  WITH CHECK (
    org_id = auth_org_id()
    AND (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "org_members_update" ON org_members FOR UPDATE
  USING (
    org_id = auth_org_id()
    AND (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "org_members_delete" ON org_members FOR DELETE
  USING (
    org_id = auth_org_id()
    AND (
      profile_id = auth.uid()
      OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    )
  );

-- ─── workspaces ──────────────────────────────────────────────────────────────
-- Ver: workspace_members de la org + admins de la org
CREATE POLICY "workspaces_select" ON workspaces FOR SELECT
  USING (
    org_id = auth_org_id()
    AND (
      (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
      OR id IN (
        SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
      )
    )
  );

CREATE POLICY "workspaces_insert" ON workspaces FOR INSERT
  WITH CHECK (
    org_id = auth_org_id()
    AND (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "workspaces_update" ON workspaces FOR UPDATE
  USING (
    org_id = auth_org_id()
    AND (
      (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
      OR id IN (
        SELECT workspace_id FROM workspace_members
        WHERE profile_id = auth.uid() AND role = 'admin'
      )
    )
  );

-- ─── workspace_members ───────────────────────────────────────────────────────
CREATE POLICY "workspace_members_select" ON workspace_members FOR SELECT
  USING (
    workspace_id IN (
      SELECT id FROM workspaces WHERE org_id = auth_org_id()
    )
    AND (
      profile_id = auth.uid()
      OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
      OR workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
      )
    )
  );

CREATE POLICY "workspace_members_insert" ON workspace_members FOR INSERT
  WITH CHECK (
    workspace_id IN (SELECT id FROM workspaces WHERE org_id = auth_org_id())
    AND (
      (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
      OR workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE profile_id = auth.uid() AND role = 'admin'
      )
    )
  );

CREATE POLICY "workspace_members_delete" ON workspace_members FOR DELETE
  USING (
    workspace_id IN (SELECT id FROM workspaces WHERE org_id = auth_org_id())
    AND (
      profile_id = auth.uid()
      OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
      OR workspace_id IN (
        SELECT workspace_id FROM workspace_members
        WHERE profile_id = auth.uid() AND role = 'admin'
      )
    )
  );

-- ─── teams ───────────────────────────────────────────────────────────────────
-- Ver: miembros del workspace ven todos sus equipos
CREATE POLICY "teams_select" ON teams FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "teams_insert" ON teams FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "teams_update" ON teams FOR UPDATE
  USING (
    id IN (
      SELECT team_id FROM team_members WHERE profile_id = auth.uid() AND role = 'admin'
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── team_members ────────────────────────────────────────────────────────────
CREATE POLICY "team_members_select" ON team_members FOR SELECT
  USING (
    team_id IN (
      SELECT id FROM teams WHERE workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
      )
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "team_members_insert" ON team_members FOR INSERT
  WITH CHECK (
    team_id IN (
      SELECT team_id FROM team_members WHERE profile_id = auth.uid() AND role = 'admin'
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "team_members_delete" ON team_members FOR DELETE
  USING (
    profile_id = auth.uid()
    OR team_id IN (
      SELECT team_id FROM team_members WHERE profile_id = auth.uid() AND role = 'admin'
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── projects ────────────────────────────────────────────────────────────────
-- Ver: miembros del proyecto + admins de workspace + org admins
CREATE POLICY "projects_select" ON projects FOR SELECT
  USING (
    (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE profile_id = auth.uid() AND role IN ('admin','manager')
    )
  );

CREATE POLICY "projects_insert" ON projects FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "projects_update" ON projects FOR UPDATE
  USING (
    id IN (
      SELECT project_id FROM project_members WHERE profile_id = auth.uid() AND role = 'manager'
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR workspace_id IN (
      SELECT workspace_id FROM workspace_members
      WHERE profile_id = auth.uid() AND role = 'admin'
    )
  );

-- ─── project_members ─────────────────────────────────────────────────────────
CREATE POLICY "project_members_select" ON project_members FOR SELECT
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "project_members_insert" ON project_members FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members WHERE profile_id = auth.uid() AND role = 'manager'
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = auth.uid() AND wm.role = 'admin'
    )
  );

CREATE POLICY "project_members_delete" ON project_members FOR DELETE
  USING (
    profile_id = auth.uid()
    OR project_id IN (
      SELECT project_id FROM project_members WHERE profile_id = auth.uid() AND role = 'manager'
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── task_statuses ───────────────────────────────────────────────────────────
CREATE POLICY "task_statuses_select" ON task_statuses FOR SELECT
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "task_statuses_insert" ON task_statuses FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members WHERE profile_id = auth.uid() AND role = 'manager'
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "task_statuses_update" ON task_statuses FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE profile_id = auth.uid() AND role = 'manager'
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "task_statuses_delete" ON task_statuses FOR DELETE
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE profile_id = auth.uid() AND role = 'manager'
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── tasks ───────────────────────────────────────────────────────────────────
CREATE POLICY "tasks_select" ON tasks FOR SELECT
  USING (
    (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
  );

CREATE POLICY "tasks_insert" ON tasks FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE profile_id = auth.uid() AND role IN ('manager','member')
    )
  );

CREATE POLICY "tasks_update" ON tasks FOR UPDATE
  USING (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE profile_id = auth.uid() AND role IN ('manager','member')
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- Solo admins de proyecto o creadores pueden archivar/eliminar
CREATE POLICY "tasks_delete" ON tasks FOR DELETE
  USING (
    created_by = auth.uid()
    OR project_id IN (
      SELECT project_id FROM project_members WHERE profile_id = auth.uid() AND role = 'manager'
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── task_comments ───────────────────────────────────────────────────────────
CREATE POLICY "task_comments_select" ON task_comments FOR SELECT
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "task_comments_insert" ON task_comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND project_id IN (
      SELECT project_id FROM project_members
      WHERE profile_id = auth.uid() AND role IN ('manager','member')
    )
  );

CREATE POLICY "task_comments_update" ON task_comments FOR UPDATE
  USING (author_id = auth.uid());

CREATE POLICY "task_comments_delete" ON task_comments FOR DELETE
  USING (
    author_id = auth.uid()
    OR project_id IN (
      SELECT project_id FROM project_members WHERE profile_id = auth.uid() AND role = 'manager'
    )
  );

-- ─── task_checklists ─────────────────────────────────────────────────────────
CREATE POLICY "task_checklists_all" ON task_checklists
  USING (
    task_id IN (
      SELECT id FROM tasks WHERE project_id IN (
        SELECT project_id FROM project_members WHERE profile_id = auth.uid()
      )
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── task_checklist_items ────────────────────────────────────────────────────
CREATE POLICY "task_checklist_items_all" ON task_checklist_items
  USING (
    task_id IN (
      SELECT id FROM tasks WHERE project_id IN (
        SELECT project_id FROM project_members WHERE profile_id = auth.uid()
      )
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── task_dependencies ───────────────────────────────────────────────────────
CREATE POLICY "task_dependencies_select" ON task_dependencies FOR SELECT
  USING (
    task_id IN (
      SELECT id FROM tasks WHERE project_id IN (
        SELECT project_id FROM project_members WHERE profile_id = auth.uid()
      )
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "task_dependencies_insert" ON task_dependencies FOR INSERT
  WITH CHECK (
    task_id IN (
      SELECT id FROM tasks WHERE project_id IN (
        SELECT project_id FROM project_members
        WHERE profile_id = auth.uid() AND role IN ('manager','member')
      )
    )
  );

CREATE POLICY "task_dependencies_delete" ON task_dependencies FOR DELETE
  USING (
    task_id IN (
      SELECT id FROM tasks WHERE project_id IN (
        SELECT project_id FROM project_members
        WHERE profile_id = auth.uid() AND role IN ('manager','member')
      )
    )
  );

-- ─── labels ──────────────────────────────────────────────────────────────────
CREATE POLICY "labels_select" ON labels FOR SELECT
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "labels_insert" ON labels FOR INSERT
  WITH CHECK (
    project_id IN (
      SELECT project_id FROM project_members
      WHERE profile_id = auth.uid() AND role IN ('manager','member')
    )
  );

CREATE POLICY "labels_delete" ON labels FOR DELETE
  USING (
    project_id IN (
      SELECT project_id FROM project_members WHERE profile_id = auth.uid() AND role = 'manager'
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── task_labels ─────────────────────────────────────────────────────────────
CREATE POLICY "task_labels_select" ON task_labels FOR SELECT
  USING (
    task_id IN (
      SELECT id FROM tasks WHERE project_id IN (
        SELECT project_id FROM project_members WHERE profile_id = auth.uid()
      )
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "task_labels_insert" ON task_labels FOR INSERT
  WITH CHECK (
    task_id IN (
      SELECT id FROM tasks WHERE project_id IN (
        SELECT project_id FROM project_members
        WHERE profile_id = auth.uid() AND role IN ('manager','member')
      )
    )
  );

CREATE POLICY "task_labels_delete" ON task_labels FOR DELETE
  USING (
    task_id IN (
      SELECT id FROM tasks WHERE project_id IN (
        SELECT project_id FROM project_members
        WHERE profile_id = auth.uid() AND role IN ('manager','member')
      )
    )
  );

-- ─── activity_events ─────────────────────────────────────────────────────────
-- INSERT solo vía service_role (logActivity usa service_role en su impl)
CREATE POLICY "activity_events_select" ON activity_events FOR SELECT
  USING (
    workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── notifications ───────────────────────────────────────────────────────────
CREATE POLICY "notifications_select" ON notifications FOR SELECT
  USING (recipient_id = auth.uid());

CREATE POLICY "notifications_update" ON notifications FOR UPDATE
  USING  (recipient_id = auth.uid())
  WITH CHECK (recipient_id = auth.uid());

CREATE POLICY "notifications_delete" ON notifications FOR DELETE
  USING (recipient_id = auth.uid());

-- ─── attachments ─────────────────────────────────────────────────────────────
CREATE POLICY "attachments_select" ON attachments FOR SELECT
  USING (
    (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR created_by = auth.uid()
    OR (visibility = 'workspace' AND workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    ))
    OR (visibility = 'project' AND project_id IN (
        SELECT project_id FROM project_members WHERE profile_id = auth.uid()
    ))
    OR (visibility = 'team' AND team_id IN (
        SELECT team_id FROM team_members WHERE profile_id = auth.uid()
    ))
  );

CREATE POLICY "attachments_insert" ON attachments FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "attachments_delete" ON attachments FOR DELETE
  USING (
    created_by = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── notes ───────────────────────────────────────────────────────────────────
CREATE POLICY "notes_select" ON notes FOR SELECT
  USING (
    (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR created_by = auth.uid()
    OR (visibility = 'workspace' AND workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    ))
    OR (visibility = 'project' AND project_id IN (
        SELECT project_id FROM project_members WHERE profile_id = auth.uid()
    ))
  );

CREATE POLICY "notes_insert" ON notes FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "notes_update" ON notes FOR UPDATE
  USING (
    created_by = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "notes_delete" ON notes FOR DELETE
  USING (
    created_by = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ─── whiteboards ─────────────────────────────────────────────────────────────
CREATE POLICY "whiteboards_select" ON whiteboards FOR SELECT
  USING (
    (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR created_by = auth.uid()
    OR (visibility = 'workspace' AND workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    ))
    OR (visibility = 'project' AND project_id IN (
        SELECT project_id FROM project_members WHERE profile_id = auth.uid()
    ))
  );

CREATE POLICY "whiteboards_insert" ON whiteboards FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND workspace_id IN (
      SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    )
  );

CREATE POLICY "whiteboards_update" ON whiteboards FOR UPDATE
  USING (
    created_by = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "whiteboards_delete" ON whiteboards FOR DELETE
  USING (
    created_by = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );


-- ════════════════════════════════════════════════════════════
-- 5. TRIGGERS updated_at
-- ════════════════════════════════════════════════════════════

CREATE TRIGGER organizations_updated_at       BEFORE UPDATE ON organizations       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER profiles_updated_at            BEFORE UPDATE ON profiles            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER workspaces_updated_at          BEFORE UPDATE ON workspaces          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER teams_updated_at               BEFORE UPDATE ON teams               FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER projects_updated_at            BEFORE UPDATE ON projects            FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tasks_updated_at               BEFORE UPDATE ON tasks               FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER task_comments_updated_at       BEFORE UPDATE ON task_comments       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER task_checklist_items_updated_at BEFORE UPDATE ON task_checklist_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER notes_updated_at               BEFORE UPDATE ON notes               FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER whiteboards_updated_at         BEFORE UPDATE ON whiteboards         FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- ════════════════════════════════════════════════════════════
-- 6. ÍNDICES (queries más frecuentes)
-- ════════════════════════════════════════════════════════════

-- profiles
CREATE INDEX idx_profiles_org         ON profiles(org_id);
CREATE INDEX idx_profiles_email       ON profiles(email);

-- org_members
CREATE INDEX idx_org_members_org      ON org_members(org_id);
CREATE INDEX idx_org_members_profile  ON org_members(profile_id);

-- workspaces
CREATE INDEX idx_workspaces_org       ON workspaces(org_id);
CREATE INDEX idx_workspaces_slug      ON workspaces(org_id, slug);

-- workspace_members
CREATE INDEX idx_wm_workspace         ON workspace_members(workspace_id);
CREATE INDEX idx_wm_profile           ON workspace_members(profile_id);

-- teams
CREATE INDEX idx_teams_workspace      ON teams(workspace_id);

-- team_members
CREATE INDEX idx_tm_team              ON team_members(team_id);
CREATE INDEX idx_tm_profile           ON team_members(profile_id);

-- projects
CREATE INDEX idx_projects_team        ON projects(team_id);
CREATE INDEX idx_projects_workspace   ON projects(workspace_id);
CREATE INDEX idx_projects_slug        ON projects(team_id, slug);
CREATE INDEX idx_projects_archived    ON projects(is_archived) WHERE NOT is_archived;

-- project_members
CREATE INDEX idx_pm_project           ON project_members(project_id);
CREATE INDEX idx_pm_profile           ON project_members(profile_id);

-- task_statuses
CREATE INDEX idx_ts_project           ON task_statuses(project_id);

-- tasks (los más críticos para rendimiento)
CREATE INDEX idx_tasks_project        ON tasks(project_id);
CREATE INDEX idx_tasks_workspace      ON tasks(workspace_id);
CREATE INDEX idx_tasks_status         ON tasks(status_id);
CREATE INDEX idx_tasks_assignee       ON tasks(assignee_id);
CREATE INDEX idx_tasks_sort           ON tasks(project_id, sort_order);
CREATE INDEX idx_tasks_archived       ON tasks(is_archived) WHERE NOT is_archived;
CREATE INDEX idx_tasks_due            ON tasks(due_date) WHERE due_date IS NOT NULL;

-- task_comments
CREATE INDEX idx_tc_task              ON task_comments(task_id);
CREATE INDEX idx_tc_workspace         ON task_comments(workspace_id);

-- task_checklists / items
CREATE INDEX idx_tcl_task             ON task_checklists(task_id);
CREATE INDEX idx_tcli_checklist       ON task_checklist_items(checklist_id);
CREATE INDEX idx_tcli_task            ON task_checklist_items(task_id);

-- task_labels
CREATE INDEX idx_tl_task              ON task_labels(task_id);
CREATE INDEX idx_tl_label             ON task_labels(label_id);

-- activity_events
CREATE INDEX idx_ae_workspace         ON activity_events(workspace_id);
CREATE INDEX idx_ae_project           ON activity_events(project_id);
CREATE INDEX idx_ae_subject           ON activity_events(subject_id);
CREATE INDEX idx_ae_created           ON activity_events(created_at DESC);
CREATE INDEX idx_ae_workspace_created ON activity_events(workspace_id, created_at DESC);

-- notifications
CREATE INDEX idx_notif_recipient      ON notifications(recipient_id);
CREATE INDEX idx_notif_unread         ON notifications(recipient_id, is_read) WHERE NOT is_read;

-- attachments
CREATE INDEX idx_att_workspace        ON attachments(workspace_id);
CREATE INDEX idx_att_project          ON attachments(project_id);

-- notes / whiteboards
CREATE INDEX idx_notes_workspace      ON notes(workspace_id);
CREATE INDEX idx_notes_project        ON notes(project_id);
CREATE INDEX idx_wb_workspace         ON whiteboards(workspace_id);
CREATE INDEX idx_wb_project           ON whiteboards(project_id);

-- Full-text search en tareas (trigram)
CREATE INDEX idx_tasks_title_trgm     ON tasks USING GIN (title gin_trgm_ops);
CREATE INDEX idx_notes_title_trgm     ON notes  USING GIN (title gin_trgm_ops);


-- ════════════════════════════════════════════════════════════
-- 7. DATOS SEMILLA (statuses por defecto al crear proyecto)
-- ════════════════════════════════════════════════════════════
-- Se llaman desde la app al crear un proyecto vía API
-- Ver: src/app/api/projects/route.ts → crear task_statuses por defecto

-- Función helper para insertar statuses por defecto en un proyecto nuevo
CREATE OR REPLACE FUNCTION create_default_statuses(p_project_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO task_statuses (project_id, name, color, category, position) VALUES
    (p_project_id, 'Por hacer',    '#6b7280', 'todo',        0),
    (p_project_id, 'En progreso',  '#3b82f6', 'in_progress', 1),
    (p_project_id, 'En revisión',  '#f59e0b', 'in_progress', 2),
    (p_project_id, 'Completado',   '#22c55e', 'done',        3),
    (p_project_id, 'Cancelado',    '#ef4444', 'cancelled',   4);
END;
$$;

GRANT EXECUTE ON FUNCTION create_default_statuses TO authenticated;

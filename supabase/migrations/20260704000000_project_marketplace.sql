-- ════════════════════════════════════════════════════════════════════════════
-- PROJECT MARKETPLACE  ·  Postulaciones + Liderazgo por proyecto + Review anonimo + CV
-- ────────────────────────────────────────────────────────────────────────────
-- Nueva logica de producto sobre el motor de proyectos existente. 100% ADITIVA:
-- no borra ni reescribe datos previos, solo agrega columnas y tablas nuevas.
--
--   * projects.*            : "charter" de proyecto (alcance, reglas, entregables),
--                             lider por proyecto y apertura a postulaciones.
--   * project_members.*     : titulo/contribucion para alimentar el CV interno.
--   * project_applications  : una persona se POSTULA a un proyecto abierto.
--   * project_reviews       : calificacion ANONIMA entre companeros del proyecto.
--   * profile_reputation()  : agregados de reputacion con k-anonimato (>= 3 reviews).
--
-- Intencion: menos dispersion de equipos y juntas. La gente genera proyectos,
-- se postula, y su perfil acumula un historial (CV) de proyectos y reputacion.
-- ════════════════════════════════════════════════════════════════════════════

-- ─── 1. Charter de proyecto + apertura a postulaciones ───────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS lead_id               uuid REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS scope                 text,
  ADD COLUMN IF NOT EXISTS rules                 text,
  ADD COLUMN IF NOT EXISTS deliverables          text,
  ADD COLUMN IF NOT EXISTS open_for_applications boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS application_deadline  timestamptz,
  ADD COLUMN IF NOT EXISTS max_members           smallint;

-- El lider por defecto es quien genero el proyecto (no hay lider organizacional fijo).
UPDATE projects SET lead_id = created_by WHERE lead_id IS NULL;

CREATE INDEX IF NOT EXISTS projects_open_idx
  ON projects(workspace_id) WHERE open_for_applications;

-- ─── 2. Enriquecer membresia para el CV ──────────────────────────────────────
ALTER TABLE project_members
  ADD COLUMN IF NOT EXISTS title        text,
  ADD COLUMN IF NOT EXISTS contribution text,
  ADD COLUMN IF NOT EXISTS joined_at    timestamptz NOT NULL DEFAULT now();

-- ─── 3. project_applications : postulaciones ─────────────────────────────────
CREATE TABLE IF NOT EXISTS project_applications (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  applicant_id uuid        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  pitch        text        NOT NULL,
  role_desired text,
  status       text        NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','accepted','rejected','withdrawn')),
  decided_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, applicant_id)
);
ALTER TABLE project_applications ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS project_apps_project_idx   ON project_applications(project_id, status);
CREATE INDEX IF NOT EXISTS project_apps_applicant_idx ON project_applications(applicant_id);

DROP TRIGGER IF EXISTS project_applications_updated_at ON project_applications;
CREATE TRIGGER project_applications_updated_at BEFORE UPDATE ON project_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS: el postulante ve lo suyo; el lider/manager del proyecto ve las de su
-- proyecto; org owner/admin ven todo.
CREATE POLICY "apps_select" ON project_applications FOR SELECT
  USING (
    applicant_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR project_id IN (
      SELECT project_id FROM project_members
      WHERE profile_id = auth.uid() AND role = 'manager'
    )
  );

-- Solo te postulas a ti mismo, y solo dentro de un workspace del que eres miembro.
CREATE POLICY "apps_insert" ON project_applications FOR INSERT
  WITH CHECK (
    applicant_id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
  );

-- El postulante puede retirar la suya; el lider/manager decide; org admin puede.
CREATE POLICY "apps_update" ON project_applications FOR UPDATE
  USING (
    applicant_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR project_id IN (
      SELECT project_id FROM project_members
      WHERE profile_id = auth.uid() AND role = 'manager'
    )
  );

-- ─── 4. project_reviews : calificacion ANONIMA entre companeros ───────────────
CREATE TABLE IF NOT EXISTS project_reviews (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid        NOT NULL REFERENCES projects(id)   ON DELETE CASCADE,
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  reviewer_id   uuid        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  reviewee_id   uuid        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  collaboration smallint    NOT NULL CHECK (collaboration BETWEEN 1 AND 5),
  quality       smallint    NOT NULL CHECK (quality       BETWEEN 1 AND 5),
  reliability   smallint    NOT NULL CHECK (reliability   BETWEEN 1 AND 5),
  communication smallint    NOT NULL CHECK (communication BETWEEN 1 AND 5),
  comment       text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, reviewer_id, reviewee_id),
  CONSTRAINT reviews_no_self CHECK (reviewer_id <> reviewee_id)
);
ALTER TABLE project_reviews ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS reviews_reviewee_idx ON project_reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS reviews_project_idx  ON project_reviews(project_id);

-- ANONIMATO: nadie puede leer las filas crudas de las reviews que RECIBE. Solo
-- el autor ve las suyas (para no duplicar) y org owner/admin para moderacion. La
-- reputacion del evaluado se expone SOLO agregada via profile_reputation().
CREATE POLICY "reviews_select_own" ON project_reviews FOR SELECT
  USING (
    reviewer_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- Solo calificas como tu mismo, y solo a companeros del MISMO proyecto en el que
-- ambos son miembros aceptados.
CREATE POLICY "reviews_insert" ON project_reviews FOR INSERT
  WITH CHECK (
    reviewer_id = auth.uid()
    AND project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    AND reviewee_id IN (
      SELECT pm.profile_id FROM project_members pm
      WHERE pm.project_id = project_reviews.project_id
    )
  );

-- ─── 5. profile_reputation() : agregados con k-anonimato ─────────────────────
-- Devuelve promedios SOLO cuando hay >= 3 reviews (protege el anonimato: con 1-2
-- evaluaciones el evaluado podria deducir quien lo califico). Debajo del umbral
-- retorna el conteo pero los promedios en NULL.
CREATE OR REPLACE FUNCTION profile_reputation(p_profile_id uuid)
RETURNS TABLE (
  review_count      int,
  avg_collaboration numeric,
  avg_quality       numeric,
  avg_reliability   numeric,
  avg_communication numeric,
  avg_overall       numeric
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    count(*)::int,
    CASE WHEN count(*) >= 3 THEN round(avg(collaboration)::numeric, 2) END,
    CASE WHEN count(*) >= 3 THEN round(avg(quality)::numeric, 2) END,
    CASE WHEN count(*) >= 3 THEN round(avg(reliability)::numeric, 2) END,
    CASE WHEN count(*) >= 3 THEN round(avg(communication)::numeric, 2) END,
    CASE WHEN count(*) >= 3
         THEN round(avg((collaboration + quality + reliability + communication) / 4.0)::numeric, 2)
    END
  FROM project_reviews
  WHERE reviewee_id = p_profile_id;
$$;

GRANT EXECUTE ON FUNCTION profile_reputation(uuid) TO authenticated;

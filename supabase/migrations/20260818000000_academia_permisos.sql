-- ─────────────────────────────────────────────────────────────────────────────
-- Quien ve cada cosa en la Academia + posicion en el diagrama. Aditivo.
--
-- EL MODELO DE VISIBILIDAD, y por que este y no otro:
--
--   audience = 'todos'   -> cualquiera del workspace (lo de hoy). Es el DEFAULT
--                           para no cambiar el comportamiento de nada existente.
--   audience = 'perfiles'-> solo quienes tengan alguno de los perfiles listados
--                           en `audience_profiles` (texto libre: foreman,
--                           concreto, asfalto, oficina...).
--   audience = 'personas'-> solo las personas listadas en academy_video_viewers.
--
-- POR QUE UNA COLUMNA Y NO SOLO UNA TABLA DE PERMISOS. Con solo la tabla, "es
-- para todos" y "no le he dado acceso a nadie todavia" se ven IGUAL: cero
-- filas. Un video nuevo quedaria invisible sin que nadie entienda por que. La
-- columna hace explicita la intencion; la tabla solo lista a quien.
--
-- LOS PERFILES SON TEXTO, NO UNA TABLA. Un catalogo de perfiles seria una
-- pantalla mas que mantener para algo que cambia con cada cuadrilla. Se guardan
-- como etiquetas en profiles.academy_profiles y se comparan por igualdad.
--
-- POSICION EN EL DIAGRAMA: dos numeros por video. Viven aqui y no en un jsonb
-- del stack porque el video es de UN diagrama y mover uno no debe reescribir
-- el documento entero (misma leccion que la pizarra).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE academy_videos
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'todos'
    CHECK (audience IN ('todos','perfiles','personas')),
  ADD COLUMN IF NOT EXISTS audience_profiles text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS diagram_x double precision,
  ADD COLUMN IF NOT EXISTS diagram_y double precision;

ALTER TABLE academy_paths
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'todos'
    CHECK (audience IN ('todos','perfiles','personas')),
  ADD COLUMN IF NOT EXISTS audience_profiles text[] NOT NULL DEFAULT '{}';

-- Etiquetas de perfil de academia por persona (foreman, concreto, asfalto...).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS academy_profiles text[] NOT NULL DEFAULT '{}';

-- Lista nominal, para audience='personas'.
CREATE TABLE IF NOT EXISTS academy_video_viewers (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id   uuid        NOT NULL REFERENCES academy_videos(id) ON DELETE CASCADE,
  profile_id uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (video_id, profile_id)
);
ALTER TABLE academy_video_viewers ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_acad_viewers_video ON academy_video_viewers(video_id);
CREATE INDEX IF NOT EXISTS idx_acad_viewers_profile ON academy_video_viewers(profile_id);
ALTER TABLE academy_video_viewers REPLICA IDENTITY FULL;

-- Cada quien ve SU propia asignacion; solo admin la administra.
CREATE POLICY "acad_viewers_select" ON academy_video_viewers FOR SELECT
  USING (
    profile_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );
CREATE POLICY "acad_viewers_write" ON academy_video_viewers FOR ALL
  USING ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'));

CREATE INDEX IF NOT EXISTS idx_academy_videos_audience ON academy_videos(audience);

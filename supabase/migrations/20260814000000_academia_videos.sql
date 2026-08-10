-- ─────────────────────────────────────────────────────────────────────────────
-- Galeria de videos de la Academia. Aditivo. No toca ninguna tabla existente.
--
-- Modelo (mismo espiritu que 20260722000000_academy.sql): el video BINARIO
-- vive en Storage (bucket privado `academy-videos`, solo service_role: sin
-- policies de storage, todo acceso pasa por URLs firmadas que emite el API).
-- La BD guarda el CATALOGO (academy_videos) y el avance POR PERSONA
-- (academy_video_progress).
--
-- Los capitulos van como jsonb y se validan en la app (validarCapitulos):
-- un CHECK de SQL sobre estructura jsonb seria una segunda implementacion de
-- la misma regla, condenada a desincronizarse de la primera.
--
-- LANDMINES respetadas:
--   * Ningun FK que cierre ciclo (videos -> profiles, progress -> videos).
--   * Ninguna policy RLS con subquery a su PROPIA tabla (sin recursion 42P17):
--     todas las subqueries apuntan a `profiles`.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Bucket privado. Limite 2GB por archivo; mimes de video + miniaturas. ─────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'academy-videos', 'academy-videos', false, 2147483648,
  ARRAY['video/mp4','video/webm','video/quicktime','image/jpeg','image/png','image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- ── academy_videos: catalogo ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_videos (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title            text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description      text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  storage_path     text        NOT NULL UNIQUE CHECK (char_length(storage_path) BETWEEN 1 AND 500),
  thumbnail_path   text        CHECK (thumbnail_path IS NULL OR char_length(thumbnail_path) <= 500),
  duration_seconds integer     CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  chapters         jsonb       NOT NULL DEFAULT '[]'::jsonb,
  tags             text[]      NOT NULL DEFAULT '{}',
  status           text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live')),
  created_by       uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE academy_videos ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_academy_videos_status ON academy_videos(status, created_at DESC);
ALTER TABLE academy_videos REPLICA IDENTITY FULL;

-- ── academy_video_progress: avance por persona ───────────────────────────────
CREATE TABLE IF NOT EXISTS academy_video_progress (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id      uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  video_id        uuid        NOT NULL REFERENCES academy_videos(id) ON DELETE CASCADE,
  last_position   integer     NOT NULL DEFAULT 0 CHECK (last_position >= 0),
  seconds_watched integer     NOT NULL DEFAULT 0 CHECK (seconds_watched >= 0),
  completed       boolean     NOT NULL DEFAULT false,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, video_id)
);
ALTER TABLE academy_video_progress ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_academy_vprog_profile ON academy_video_progress(profile_id, updated_at DESC);
ALTER TABLE academy_video_progress REPLICA IDENTITY FULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Mismo patron que el resto de academy_*: el API usa admin client con checks
-- explicitos; estas policies son la red por si algo consulta con el client
-- anon/usuario.

-- Catalogo: cualquier usuario autenticado LEE lo publicado; borradores y toda
-- escritura, solo admin/owner de la org.
CREATE POLICY "academy_videos_select" ON academy_videos FOR SELECT
  USING (
    (status = 'live' AND auth.uid() IS NOT NULL)
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );
CREATE POLICY "academy_videos_write" ON academy_videos FOR ALL
  USING ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- Avance: fila propia o admin (lectura); escritura solo la fila propia.
CREATE POLICY "academy_vprog_select" ON academy_video_progress FOR SELECT
  USING (
    profile_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );
CREATE POLICY "academy_vprog_insert" ON academy_video_progress FOR INSERT
  WITH CHECK (profile_id = auth.uid());
CREATE POLICY "academy_vprog_update" ON academy_video_progress FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

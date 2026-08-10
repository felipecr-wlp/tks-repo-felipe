-- ─────────────────────────────────────────────────────────────────────────────
-- Rutas de aprendizaje. Aditivo.
--
-- QUE ES UNA RUTA. Un punto de entrada con nombre: "Bienvenido a tu primer
-- dia". Desde ahi el video pregunta (concreto o asfalto), cada respuesta lleva
-- a otro video, ese vuelve a preguntar, y asi. La ruta es la puerta; el arbol
-- de caminos NO se guarda aqui.
--
-- POR QUE EL ARBOL NO SE GUARDA. Ya existe: son los `go` de las interacciones
-- de cada video. Guardarlo otra vez en una tabla de aristas seria una segunda
-- copia de la misma verdad, y el dia que alguien edite una pregunta y no la
-- tabla, la ruta enseñaria un mapa que no coincide con lo que pasa al
-- reproducir. El arbol se DERIVA caminando los `go` (ver construirArbol).
--
-- Por eso una ruta solo necesita saber por donde se ENTRA.
--
-- LANDMINES: sin ciclos de FK; RLS sin subquery a su propia tabla.
-- El FK a academy_videos es ON DELETE SET NULL, no CASCADE: borrar el video de
-- entrada no debe evaporar la ruta y su nombre, debe dejarla visiblemente
-- descabezada para que alguien la repare.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS academy_paths (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description     text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  school_id       uuid        REFERENCES academy_schools(id) ON DELETE SET NULL,
  entry_video_id  uuid        REFERENCES academy_videos(id) ON DELETE SET NULL,
  accent          text        NOT NULL DEFAULT '#6366f1' CHECK (char_length(accent) <= 16),
  position        integer     NOT NULL DEFAULT 0,
  status          text        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','live')),
  created_by      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE academy_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_paths REPLICA IDENTITY FULL;
CREATE INDEX IF NOT EXISTS idx_academy_paths_school ON academy_paths(school_id, position);

CREATE POLICY "academy_paths_select" ON academy_paths FOR SELECT
  USING (
    (status = 'live' AND auth.uid() IS NOT NULL)
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );
CREATE POLICY "academy_paths_write" ON academy_paths FOR ALL
  USING ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ─────────────────────────────────────────────────────────────────────────────
-- Stacks de la galeria + interactividad en los videos. Aditivo.
--
-- STACK: coleccion con nombre y orden (ej. "Remote Paving Advisors", "Dia de
-- concreto"). Un video pertenece a lo mas a UN stack (stack_id nullable): la
-- galeria se organiza por stacks como un LMS, no como una lista plana. Borrar
-- un stack NO borra sus videos (ON DELETE SET NULL): quedan como sueltos.
--
-- INTERACTIONS: preguntas ancladas a un segundo del video, jsonb validado en
-- la app (validarInteracciones), mismo criterio que chapters: un CHECK de SQL
-- seria una segunda implementacion de la regla.
--
-- LANDMINES respetadas: sin ciclos de FK; RLS sin subquery a su propia tabla.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS academy_stacks (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  description text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  accent      text        NOT NULL DEFAULT '#f59e0b' CHECK (char_length(accent) <= 16),
  position    integer     NOT NULL DEFAULT 0,
  created_by  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE academy_stacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_stacks REPLICA IDENTITY FULL;

ALTER TABLE academy_videos
  ADD COLUMN IF NOT EXISTS stack_id uuid REFERENCES academy_stacks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS interactions jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_academy_videos_stack ON academy_videos(stack_id, created_at DESC);

-- RLS: leer cualquiera autenticado; escribir solo admin/owner (mismo patron
-- que academy_videos).
CREATE POLICY "academy_stacks_select" ON academy_stacks FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "academy_stacks_write" ON academy_stacks FOR ALL
  USING ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'));

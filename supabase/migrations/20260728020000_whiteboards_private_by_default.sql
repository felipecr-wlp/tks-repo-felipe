-- =============================================================================
-- 2026-07-28. Las pizarras siguen la MISMA regla que las notas.
--
-- Regla de negocio (Ali): nace privada de su autor; compartirla significa su
-- DEPARTAMENTO, no la empresa; abrirla a la empresa entera es acto de mando.
--
-- Antes de esto: `NewWhiteboardButton` mandaba visibility 'workspace'
-- hardcodeado y la API tenia ese mismo default, o sea toda pizarra nacia
-- visible para los 30 miembros. Las 7 que existen estan asi.
--
-- Cambios:
--   1. Nueva columna `space_id`: las pizarras no tenian a que departamento
--      pertenecer, asi que el alcance departamento era imposible de expresar.
--   2. Nueva columna `note_id`: una pizarra INCRUSTADA en una nota no tiene
--      alcance propio, hereda el de su nota. Sin esto, compartir la nota con el
--      departamento dejaria el dibujo invisible para los que leen la nota.
--   3. CHECK admite 'space'; DEFAULT de la columna pasa a 'private'.
--   4. Backfill de lo que nacio 'workspace' sin que nadie lo pidiera.
--   5. La policy `whiteboards_select` aprende departamento y herencia de nota.
--
-- Aditiva e idempotente.
-- =============================================================================

-- (1) y (2) Columnas nuevas -------------------------------------------------
-- Una sola FK por par de tablas: no se cierra ningun ciclo, asi que PostgREST
-- no se ambigua al resolver embeds (ver landmine de migraciones).
ALTER TABLE whiteboards
  ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES spaces(id) ON DELETE SET NULL;

ALTER TABLE whiteboards
  ADD COLUMN IF NOT EXISTS note_id uuid REFERENCES notes(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS whiteboards_space_id_idx ON whiteboards(space_id);
CREATE INDEX IF NOT EXISTS whiteboards_note_id_idx  ON whiteboards(note_id);

-- Herencia retroactiva: las pizarras que YA estaban incrustadas quedan atadas a
-- su nota. El bloque del editor guarda el id dentro del HTML, asi que se
-- reconoce por ahi. En produccion no habia ninguna (las 7 eran sueltas), pero
-- otros entornos si pueden tenerlas y sin esto se volverian invisibles.
UPDATE whiteboards w
SET note_id = n.id
FROM notes n
WHERE w.note_id IS NULL
  AND n.workspace_id = w.workspace_id
  AND n.content LIKE '%data-whiteboard%'
  AND n.content LIKE '%' || w.id::text || '%';

-- (3) Alcance departamento y nacimiento privado -----------------------------
ALTER TABLE whiteboards DROP CONSTRAINT IF EXISTS whiteboards_visibility_check;
ALTER TABLE whiteboards ADD CONSTRAINT whiteboards_visibility_check
  CHECK (visibility IN ('private', 'space', 'team', 'project', 'workspace'));

ALTER TABLE whiteboards ALTER COLUMN visibility SET DEFAULT 'private';

-- (4) Backfill --------------------------------------------------------------
-- Nadie eligio 'workspace': era el default del boton. Vuelven con su autor, que
-- las comparte de nuevo en un clic si asi lo quiere.
UPDATE whiteboards
SET visibility = 'private'
WHERE visibility = 'workspace';

-- (5) Policy de lectura -----------------------------------------------------
-- Red de abajo: la app lee con service-role y aplica la misma regla en
-- `src/lib/whiteboard-visibility.ts`. Aqui se replica, incluida la herencia:
-- si la pizarra vive dentro de una nota, manda el alcance de la nota.
DROP POLICY IF EXISTS "whiteboards_select" ON whiteboards;
CREATE POLICY "whiteboards_select" ON whiteboards FOR SELECT
  USING (
    (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR created_by = auth.uid()
    -- Pizarra incrustada: hereda de su nota, que trae su propia policy.
    OR (note_id IS NOT NULL AND note_id IN (SELECT id FROM notes))
    OR (visibility = 'workspace' AND workspace_id IN (
        SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid()
    ))
    OR (visibility = 'project' AND project_id IN (
        SELECT project_id FROM project_members WHERE profile_id = auth.uid()
    ))
    OR (visibility IN ('space','team') AND space_id IN (
        SELECT space_id FROM space_members WHERE profile_id = auth.uid()
    ))
  );

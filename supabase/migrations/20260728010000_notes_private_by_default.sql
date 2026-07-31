-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-07-28. Las notas nacen PRIVADAS y compartir significa DEPARTAMENTO.
--
-- Regla de negocio (Ali): una nota es de su autor hasta que el autor decide
-- compartirla, y compartirla NO la abre a toda la empresa: la abre a su
-- departamento. Publicar a la empresa entera sigue existiendo (los SOPs lo
-- necesitan) pero pasa a ser acto de mando, validado en la capa de API con
-- `canPostWorkspaceMessage`.
--
-- Antes de esto: el arbol de notas creaba TODO con visibility 'workspace'
-- (hardcodeado en NotesTreeSidebar), o sea cada nota nacia visible para los 30
-- miembros del workspace. Nadie eligio eso, era el default del codigo.
--
-- Cambios:
--   1. Nuevo valor 'space' en el CHECK (alcance departamento explicito).
--   2. DEFAULT de la columna pasa a 'private'.
--   3. Backfill: las notas normales que hoy estan en 'workspace' bajan a
--      'private'. Los documentos operativos (SOP, training, indices) NO se
--      tocan: por diseño alcanzan a todos y se acusan de recibido.
--   4. La policy `notes_select` aprende el alcance departamento.
--
-- Aditiva e idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── (1) El CHECK admite 'space' ─────────────────────────────────────────────
ALTER TABLE notes DROP CONSTRAINT IF EXISTS notes_visibility_check;
ALTER TABLE notes ADD CONSTRAINT notes_visibility_check
  CHECK (visibility IN ('private', 'space', 'team', 'project', 'workspace'));

-- ── (2) Toda nota nueva nace privada ────────────────────────────────────────
ALTER TABLE notes ALTER COLUMN visibility SET DEFAULT 'private';

-- ── (3) Backfill de lo que nacio 'workspace' sin que nadie lo pidiera ───────
-- Solo notas normales. doc_kind <> 'note' (sop, sop_flow, sop_index, training)
-- se queda como esta: su alcance de empresa es intencional.
UPDATE notes
SET visibility = 'private'
WHERE visibility = 'workspace'
  AND COALESCE(doc_kind, 'note') = 'note';

-- ── (4) La policy de lectura aprende el alcance departamento ────────────────
-- Sigue siendo la red de abajo: la app lee con service-role y aplica la misma
-- regla en `src/lib/note-visibility.ts`. La policy RESTRICTIVE
-- `notes_restrict_space` (migracion 20260718130000) sigue vigente encima y no
-- se toca: un departamento restringido bloquea incluso una nota 'workspace'.
DROP POLICY IF EXISTS "notes_select" ON notes;
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
    OR (visibility IN ('space','team') AND space_id IN (
        SELECT space_id FROM space_members WHERE profile_id = auth.uid()
    ))
  );

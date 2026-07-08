-- ════════════════════════════════════════════════════════════
-- Notes hierarchy + icon
-- ════════════════════════════════════════════════════════════
-- Permite organizar notas como wiki: páginas con sub-páginas anidadas.
-- También agrega un icon (emoji) para identificación visual rápida.
-- ════════════════════════════════════════════════════════════

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS parent_note_id uuid
    REFERENCES notes(id) ON DELETE CASCADE;

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS icon text;

-- Índice para queries jerárquicos eficientes
CREATE INDEX IF NOT EXISTS notes_parent_note_id_idx
  ON notes(parent_note_id);

-- Índice combinado workspace + parent (para listar root notes y children)
CREATE INDEX IF NOT EXISTS notes_workspace_parent_idx
  ON notes(workspace_id, parent_note_id);

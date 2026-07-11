-- ─────────────────────────────────────────────────────────────────────────────
-- Conversación A, Circuito A2: comentarios dentro de una nota (docs colaborativos)
-- Aditivo. No toca notes, task_comments ni ninguna tabla existente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── note_comments ───────────────────────────────────────────────────────────
-- Hilo lateral de comentarios de una nota. Reutiliza el patrón de task_comments,
-- pero las notas son de alcance workspace (no de proyecto), así que la seguridad
-- se ancla en workspace_members.
CREATE TABLE IF NOT EXISTS note_comments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id      uuid        NOT NULL REFERENCES notes(id)      ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id    uuid        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  content      text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE note_comments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_nc_note      ON note_comments(note_id, created_at);
CREATE INDEX IF NOT EXISTS idx_nc_workspace ON note_comments(workspace_id);

CREATE POLICY "note_comments_select" ON note_comments FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE POLICY "note_comments_insert" ON note_comments FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
  );

CREATE POLICY "note_comments_update" ON note_comments FOR UPDATE
  USING (author_id = auth.uid());

CREATE POLICY "note_comments_delete" ON note_comments FOR DELETE
  USING (
    author_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

CREATE TRIGGER note_comments_updated_at BEFORE UPDATE ON note_comments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── note_mentions ───────────────────────────────────────────────────────────
-- Registro de menciones para notificar al inbox. Espejo de task_mentions.
CREATE TABLE IF NOT EXISTS note_mentions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id      uuid        NOT NULL REFERENCES notes(id)    ON DELETE CASCADE,
  mentioned_id uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mentioned_by uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source       text        NOT NULL DEFAULT 'comment',
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE note_mentions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_nm_mentioned ON note_mentions(mentioned_id, created_at);
CREATE INDEX IF NOT EXISTS idx_nm_note      ON note_mentions(note_id);

CREATE POLICY "note_mentions_select" ON note_mentions FOR SELECT
  USING (mentioned_id = auth.uid() OR mentioned_by = auth.uid());

CREATE POLICY "note_mentions_insert" ON note_mentions FOR INSERT
  WITH CHECK (mentioned_by = auth.uid());

-- ─── Realtime: hilo de comentarios en vivo (best effort) ─────────────────────
-- Añade note_comments a la publicación de realtime si existe, para que el hilo
-- se actualice sin recargar. Envuelto en DO para no fallar si la publicación no
-- está configurada así.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE note_comments;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

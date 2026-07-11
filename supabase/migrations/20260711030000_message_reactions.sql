-- ─────────────────────────────────────────────────────────────────────────────
-- Conversacion B, Circuito B9: reacciones con emoji en el chat del proyecto.
-- Aditivo. No toca project_messages ni ninguna tabla existente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── message_reactions ───────────────────────────────────────────────────────
-- Una reaccion = (mensaje, persona, emoji). El unique evita reacciones duplicadas
-- de la misma persona con el mismo emoji sobre el mismo mensaje (toggle idempotente).
-- La seguridad se ancla en el proyecto, igual que project_messages: miembros del
-- proyecto o de su workspace pueden ver/reaccionar.
CREATE TABLE IF NOT EXISTS message_reactions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid        NOT NULL REFERENCES project_messages(id) ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES projects(id)         ON DELETE CASCADE,
  profile_id   uuid        NOT NULL REFERENCES profiles(id)         ON DELETE CASCADE,
  emoji        text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, profile_id, emoji)
);
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_mr_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_mr_project ON message_reactions(project_id);

-- REPLICA IDENTITY FULL: para que los eventos DELETE de realtime incluyan
-- project_id y message_id en el payload "old" (el default solo trae la PK), y asi
-- el cliente pueda filtrar por proyecto y quitar el pill correcto sin recargar.
ALTER TABLE message_reactions REPLICA IDENTITY FULL;

-- Lectura: miembro del proyecto, o miembro del workspace del proyecto, o admin/owner.
CREATE POLICY "message_reactions_select" ON message_reactions FOR SELECT
  USING (
    project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
    OR project_id IN (
      SELECT p.id FROM projects p
      JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
      WHERE wm.profile_id = auth.uid()
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- Insercion: solo la propia persona, y debe tener acceso al proyecto.
CREATE POLICY "message_reactions_insert" ON message_reactions FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    AND (
      project_id IN (SELECT project_id FROM project_members WHERE profile_id = auth.uid())
      OR project_id IN (
        SELECT p.id FROM projects p
        JOIN workspace_members wm ON wm.workspace_id = p.workspace_id
        WHERE wm.profile_id = auth.uid()
      )
    )
  );

-- Borrado: solo la propia reaccion (retirar el emoji).
CREATE POLICY "message_reactions_delete" ON message_reactions FOR DELETE
  USING (profile_id = auth.uid());

-- ─── Realtime: reacciones en vivo (best effort) ──────────────────────────────
-- Anade message_reactions a la publicacion de realtime si existe, para que las
-- reacciones aparezcan sin recargar. Envuelto en DO para no fallar si no aplica.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE message_reactions;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Chat GENERAL del workspace, v2: paridad con el chat de equipo.
--
-- Agrega (a) adjuntos de archivo a workspace_messages (columna attachments jsonb,
-- igual formato que messages.attachments) y (b) reacciones emoji en una tabla
-- dedicada workspace_message_reactions (espeja team_message_reactions pero
-- scopeada por workspace_id).
--
-- Aditivo y seguro (mismos criterios que las tablas de chat previas):
--  - columna nueva NULLABLE en workspace_messages, sin default pesado.
--  - tabla nueva, FK solo a tablas hoja (workspace_messages, workspaces,
--    profiles): sin ciclos -> sin HTTP 300.
--  - RLS con subquery a workspace_members (otra tabla), nunca a si misma: sin
--    recursion 42P17.
-- ─────────────────────────────────────────────────────────────────────────────

-- (a) Adjuntos en el mensaje del canal General (v1 era solo texto).
ALTER TABLE workspace_messages ADD COLUMN IF NOT EXISTS attachments jsonb;

-- (b) Reacciones emoji del canal General.
CREATE TABLE IF NOT EXISTS workspace_message_reactions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid        NOT NULL REFERENCES workspace_messages(id) ON DELETE CASCADE,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id)         ON DELETE CASCADE,
  profile_id   uuid        NOT NULL REFERENCES profiles(id)           ON DELETE CASCADE,
  emoji        text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, profile_id, emoji)
);
ALTER TABLE workspace_message_reactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_wmr_message   ON workspace_message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_wmr_workspace ON workspace_message_reactions(workspace_id);

-- REPLICA IDENTITY FULL: para que el payload "old" de los DELETE de realtime
-- traiga workspace_id y message_id (el default solo trae la PK) y el cliente
-- pueda quitar el pill correcto sin recargar.
ALTER TABLE workspace_message_reactions REPLICA IDENTITY FULL;

-- Lectura: miembro del workspace, o admin/owner de la organizacion.
CREATE POLICY "wmr_select" ON workspace_message_reactions FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- Insercion: solo la propia persona, y solo en un workspace del que es miembro.
CREATE POLICY "wmr_insert" ON workspace_message_reactions FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
  );

-- Borrado: solo la propia reaccion.
CREATE POLICY "wmr_delete" ON workspace_message_reactions FOR DELETE
  USING (profile_id = auth.uid());

-- Realtime en vivo (best effort).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE workspace_message_reactions;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

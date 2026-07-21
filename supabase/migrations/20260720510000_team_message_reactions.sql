-- ─────────────────────────────────────────────────────────────────────────────
-- Track 1, Circuito 1.D: reacciones emoji en el chat de EQUIPO (tabla messages).
-- Espeja message_reactions (que es para project_messages) sin tocarla. Aditivo:
-- tabla nueva, sin ciclos de FK, sin RLS que consulte su propia tabla.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS team_message_reactions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id   uuid        NOT NULL REFERENCES messages(id)  ON DELETE CASCADE,
  team_id      uuid        NOT NULL REFERENCES teams(id)     ON DELETE CASCADE,
  profile_id   uuid        NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  emoji        text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, profile_id, emoji)
);
ALTER TABLE team_message_reactions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tmr_message ON team_message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_tmr_team    ON team_message_reactions(team_id);

-- REPLICA IDENTITY FULL: para que el payload "old" de los DELETE de realtime
-- traiga team_id y message_id (el default solo trae la PK), y el cliente pueda
-- filtrar por equipo y quitar el pill correcto sin recargar.
ALTER TABLE team_message_reactions REPLICA IDENTITY FULL;

-- Lectura: miembro del equipo, o miembro del workspace del equipo, o admin/owner.
CREATE POLICY "tmr_select" ON team_message_reactions FOR SELECT
  USING (
    team_id IN (SELECT team_id FROM team_members WHERE profile_id = auth.uid())
    OR team_id IN (
      SELECT t.id FROM teams t
      JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
      WHERE wm.profile_id = auth.uid()
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- Insercion: solo la propia persona, y con acceso al equipo.
CREATE POLICY "tmr_insert" ON team_message_reactions FOR INSERT
  WITH CHECK (
    profile_id = auth.uid()
    AND (
      team_id IN (SELECT team_id FROM team_members WHERE profile_id = auth.uid())
      OR team_id IN (
        SELECT t.id FROM teams t
        JOIN workspace_members wm ON wm.workspace_id = t.workspace_id
        WHERE wm.profile_id = auth.uid()
      )
    )
  );

-- Borrado: solo la propia reaccion.
CREATE POLICY "tmr_delete" ON team_message_reactions FOR DELETE
  USING (profile_id = auth.uid());

-- Realtime en vivo (best effort).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE team_message_reactions;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

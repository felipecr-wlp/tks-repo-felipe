-- ─────────────────────────────────────────────────────────────────────────────
-- Conversacion B, Circuito B10: seguidores (watchers) de tarea.
-- Aditivo. No toca tasks ni ninguna tabla existente.
-- Un watcher = (tarea, persona). Al seguir una tarea, la persona recibe una
-- notificacion en su bandeja cada vez que la tarea se actualiza (aunque no sea
-- asignado). Paridad ClickUp/Notion.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── task_watchers ───────────────────────────────────────────────────────────
-- La seguridad se ancla en el proyecto, igual que message_reactions: miembros del
-- proyecto o de su workspace pueden ver; cada quien sigue/deja de seguir solo por
-- si mismo. project_id se guarda en la fila (poblado por el server) para que la
-- RLS resuelva membresia sin un join extra a tasks en cada policy.
CREATE TABLE IF NOT EXISTS task_watchers (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid        NOT NULL REFERENCES tasks(id)     ON DELETE CASCADE,
  project_id   uuid        NOT NULL REFERENCES projects(id)  ON DELETE CASCADE,
  profile_id   uuid        NOT NULL REFERENCES profiles(id)  ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, profile_id)
);
ALTER TABLE task_watchers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_tw_task    ON task_watchers(task_id);
CREATE INDEX IF NOT EXISTS idx_tw_profile ON task_watchers(profile_id);

-- REPLICA IDENTITY FULL: para que los eventos DELETE de realtime incluyan
-- task_id y profile_id en el payload "old" y el cliente pueda quitar el avatar
-- correcto sin recargar.
ALTER TABLE task_watchers REPLICA IDENTITY FULL;

-- Lectura: miembro del proyecto, o miembro del workspace del proyecto, o admin/owner.
CREATE POLICY "task_watchers_select" ON task_watchers FOR SELECT
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
CREATE POLICY "task_watchers_insert" ON task_watchers FOR INSERT
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

-- Borrado: solo el propio seguimiento (dejar de seguir).
CREATE POLICY "task_watchers_delete" ON task_watchers FOR DELETE
  USING (profile_id = auth.uid());

-- ─── Realtime: seguidores en vivo (best effort) ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE task_watchers;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

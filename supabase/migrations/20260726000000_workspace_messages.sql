-- ─────────────────────────────────────────────────────────────────────────────
-- Chat GENERAL del workspace (canal transversal entre equipos).
--
-- El chat de equipo (tabla messages) es estrictamente por team_id: un miembro
-- solo ve el canal de sus equipos, no existe conversacion inter-equipos. Esta
-- tabla agrega un unico canal por workspace donde participa cualquier miembro
-- del workspace, sin importar a que equipo pertenece. Es la pieza que faltaba
-- para "chatear entre equipos".
--
-- Aditivo y seguro (mismos criterios que team_message_reactions):
--  - tabla nueva, NO se toca messages.
--  - FK solo a tablas hoja (workspaces, profiles): sin ciclos -> sin HTTP 300.
--  - RLS con subquery a workspace_members (otra tabla), nunca a si misma: sin
--    recursion 42P17.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workspace_messages (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id    uuid        NOT NULL REFERENCES profiles(id)   ON DELETE CASCADE,
  body         text        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workspace_messages ENABLE ROW LEVEL SECURITY;

-- Historial por workspace ordenado por fecha (paginacion por cursor created_at).
CREATE INDEX IF NOT EXISTS idx_wsm_workspace_created
  ON workspace_messages(workspace_id, created_at DESC);

-- Lectura: miembro del workspace, o admin/owner de la organizacion (supervision).
CREATE POLICY "wsm_select" ON workspace_messages FOR SELECT
  USING (
    workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- Insercion: solo la propia persona, y solo en un workspace del que es miembro.
-- (Los admins de org escriben via su membership real; no se les da un bypass de
-- autoria para no falsear el author_id.)
CREATE POLICY "wsm_insert" ON workspace_messages FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
  );

-- Borrado: el autor del mensaje, o admin/owner de la organizacion (moderacion).
CREATE POLICY "wsm_delete" ON workspace_messages FOR DELETE
  USING (
    author_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- Realtime en vivo (best effort): el cliente se suscribe a los INSERT filtrados
-- por workspace_id.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE workspace_messages;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END $$;

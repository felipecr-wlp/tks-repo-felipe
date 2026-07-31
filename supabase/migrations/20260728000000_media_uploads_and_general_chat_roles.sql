-- ─────────────────────────────────────────────────────────────────────────────
-- 2026-07-28. Dos cambios independientes que viajan juntos:
--
--  (1) MEDIA: los buckets aceptan video y audio, y suben su tope de tamaño.
--      Motivo: el equipo de paid media trabaja con creativos en video (Meta,
--      TikTok, YouTube) y hoy el bucket los rechazaba por mime.
--      El tope real solo se alcanza por SIGNED UPLOAD URL (navegador -> storage
--      directo); el camino multipart por la API sigue acotado en el codigo por
--      debajo del techo de ~4.5MB de body que impone Vercel.
--
--  (2) CHAT GENERAL: pasa a ser canal de COMUNICADOS. Leerlo sigue siendo de
--      todo el workspace; ESCRIBIR queda reservado a mandos. La conversacion
--      del dia a dia baja al chat por departamento/equipo.
--
-- Aditiva y idempotente: no borra datos ni rompe lo existente.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── (1) Buckets ──────────────────────────────────────────────────────────────
-- Lista compartida por los dos buckets de archivos privados.
UPDATE storage.buckets
SET
  file_size_limit = 209715200, -- 200MB
  allowed_mime_types = ARRAY[
    -- Imagen
    'image/png','image/jpeg','image/gif','image/webp','image/svg+xml','image/avif',
    -- Video (creativos de campaña)
    'video/mp4','video/quicktime','video/webm','video/x-msvideo',
    -- Audio (locuciones)
    'audio/mpeg','audio/wav','audio/mp4',
    -- Documentos
    'application/pdf',
    'text/plain','text/csv','text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  ]
WHERE id IN ('task-files', 'chat-files');

-- ── (2) Quien puede publicar en el chat General ─────────────────────────────
-- Un "mando" es cualquiera de:
--   a) admin de la organizacion  (profiles.org_role owner/admin)
--   b) admin del workspace       (workspace_members.role owner/admin)
--   c) lead de algun equipo      (team_members.role = 'admin' en ese workspace)
--
-- SECURITY DEFINER + STABLE: salta RLS por dentro, sin recursion 42P17, mismo
-- patron que can_see_team.
CREATE OR REPLACE FUNCTION public.can_post_workspace_message(p_workspace uuid, p_profile uuid)
  RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    -- (a) admin de organizacion
    COALESCE((SELECT org_role FROM profiles WHERE id = p_profile), 'member') IN ('owner','admin')
    -- (b) admin del workspace
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = p_workspace
        AND wm.profile_id = p_profile
        AND wm.role IN ('owner','admin')
    )
    -- (c) lead de algun equipo del workspace
    OR EXISTS (
      SELECT 1
      FROM team_members tm
      JOIN teams t ON t.id = tm.team_id
      WHERE t.workspace_id = p_workspace
        AND tm.profile_id = p_profile
        AND tm.role = 'admin'
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_post_workspace_message(uuid, uuid) TO authenticated;

-- Refuerzo en la base, defensa en profundidad. La API tambien lo valida, pero
-- si algun dia una ruta nueva escribe sin pasar por el check, esto la detiene.
-- Reemplaza wsm_insert (creada en 20260726000000_workspace_messages.sql), que
-- solo exigia ser miembro del workspace.
DROP POLICY IF EXISTS "wsm_insert" ON public.workspace_messages;
CREATE POLICY "wsm_insert" ON public.workspace_messages FOR INSERT
  WITH CHECK (
    author_id = auth.uid()
    AND workspace_id IN (SELECT workspace_id FROM workspace_members WHERE profile_id = auth.uid())
    AND can_post_workspace_message(workspace_id, auth.uid())
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Cache de la URL firmada del video. Aditivo.
--
-- EL PROBLEMA QUE RESUELVE, medido en produccion: cada carga de la pagina
-- generaba una URL firmada NUEVA (el token lleva su propio instante de
-- emision, asi que dos llamadas nunca dan la misma cadena). Para el navegador
-- eso es OTRO archivo, asi que el cache no sirve de nada: la misma persona
-- viendo el mismo video dos veces lo descarga dos veces, y recargar a medias
-- lo descarga otra vez entero.
--
-- Con video eso no es un detalle. Un video de 200MB visto por 60 personas son
-- 12GB; si ademas cada una lo abre tres veces, son 36GB por el mismo
-- contenido.
--
-- LA SOLUCION: guardar la URL y reusarla mientras siga vigente. Todos comparten
-- la misma cadena, asi que el cache del navegador (y cualquier CDN de por
-- medio) por fin puede hacer su trabajo.
--
-- EL INTERCAMBIO, explicito: una URL que vive 24h se puede compartir durante
-- 24h. Antes duraban 4h. Para capacitacion interna es aceptable y es la misma
-- decision que ya se tomo al elegir URLs firmadas en vez de DRM. Si algun dia
-- deja de serlo, se baja el numero en un solo lugar (TTL_URL_FIRMADA).
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE academy_videos
  ADD COLUMN IF NOT EXISTS signed_url text,
  ADD COLUMN IF NOT EXISTS signed_url_expires_at timestamptz;

-- Para poder barrer las caducadas si algun dia hace falta.
CREATE INDEX IF NOT EXISTS idx_academy_videos_url_exp
  ON academy_videos(signed_url_expires_at)
  WHERE signed_url_expires_at IS NOT NULL;

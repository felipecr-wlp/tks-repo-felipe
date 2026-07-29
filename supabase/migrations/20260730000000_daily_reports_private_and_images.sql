-- ─────────────────────────────────────────────────────────────────────────────
-- REPORTE DIARIO v2: privacidad por rol + evidencia en imagen.
--
-- Dos cambios, uno de politica y uno de capacidad.
--
-- ── 1. El reporte deja de ser publico dentro del workspace ───────────────────
-- La migracion original decidio que el reporte era "informacion de coordinacion,
-- no un diario privado", y lo abrio a cualquier miembro. En la practica eso
-- cambia lo que la gente escribe: sabiendo que lo lee todo el mundo, el reporte
-- se convierte en vitrina y los bloqueos (lo unico que de verdad exige accion de
-- alguien mas) dejan de anotarse. Un reporte que se autocensura no sirve.
--
-- Nueva regla: cada quien ve el suyo. Ven el de los demas SOLO los mandos
-- (admin/owner de la organizacion, o admin/owner de ESE workspace), que son
-- quienes tienen que dar seguimiento. La escritura no cambia: nadie, ni un
-- admin, escribe el dia de otro.
--
-- Ojo con las subqueries: se consultan workspace_members y profiles (OTRAS
-- tablas), nunca daily_reports desde su propia policy -> sin recursion 42P17.
--
-- ── 2. daily_report_images: evidencia sin quemar egress ──────────────────────
-- "Deje lista la landing" vale mucho mas con la captura al lado. Pero una foto
-- de celular pesa 3-5MB, y un tablero con veinte fotos hace que cada visita se
-- baje 80MB de Supabase Storage. Por eso cada imagen se guarda DOS veces:
--
--   thumb_path  miniatura (~320px, decenas de KB). Es lo UNICO que carga el
--               listado, y se firma en lote al render.
--   path        version completa (~1600px). Solo sale de storage cuando alguien
--               hace clic para verla en grande.
--
-- La compresion ocurre en el NAVEGADOR antes de subir (canvas -> WebP): a
-- storage nunca llega el original de 5MB, asi que el ahorro es de subida, de
-- almacenamiento y de bajada a la vez. Los topes de abajo son la red que impide
-- que un cliente manipulado suba el original crudo.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Privacidad ────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "dr_select" ON daily_reports;
CREATE POLICY "dr_select" ON daily_reports FOR SELECT
  USING (
    -- El propio
    profile_id = auth.uid()
    -- Mando de la organizacion
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    -- Mando de ESE workspace
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = daily_reports.workspace_id
        AND wm.profile_id   = auth.uid()
        AND wm.role IN ('owner','admin')
    )
  );

DROP POLICY IF EXISTS "dre_select" ON daily_report_entries;
CREATE POLICY "dre_select" ON daily_report_entries FOR SELECT
  USING (
    report_id IN (SELECT id FROM daily_reports WHERE profile_id = auth.uid())
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR EXISTS (
      SELECT 1
      FROM daily_reports dr
      JOIN workspace_members wm ON wm.workspace_id = dr.workspace_id
      WHERE dr.id          = daily_report_entries.report_id
        AND wm.profile_id  = auth.uid()
        AND wm.role IN ('owner','admin')
    )
  );

-- ── 2. Imagenes de una actividad ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS daily_report_images (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   uuid        NOT NULL REFERENCES daily_report_entries(id) ON DELETE CASCADE,

  -- report_id SIN foreign key, a proposito. Ya existe un camino
  -- daily_report_images -> daily_report_entries -> daily_reports; agregar la FK
  -- directa abriria un SEGUNDO camino entre las mismas dos tablas y PostgREST
  -- responderia HTTP 300 ("more than one relationship found") en todo embed que
  -- las toque. Se guarda como uuid plano solo para agrupar y contar por reporte.
  -- La integridad la da el ON DELETE CASCADE de arriba: si muere el reporte
  -- mueren sus entradas, y con ellas sus imagenes.
  report_id  uuid        NOT NULL,

  -- Rutas dentro del bucket privado. Nunca URLs: una URL firmada caduca, y
  -- guardarla seria almacenar basura con fecha de caducidad.
  path       text        NOT NULL,
  thumb_path text        NOT NULL,

  -- Dimensiones de la version completa, para reservar el espacio en pantalla
  -- antes de que cargue y no provocar salto de layout (CLS).
  width      int,
  height     int,

  bytes      int         NOT NULL CHECK (bytes > 0),
  thumb_bytes int        NOT NULL CHECK (thumb_bytes > 0),

  -- Texto alternativo. Lo puede escribir la persona o dictarlo el agente al
  -- mirar la imagen. Sin esto una captura es invisible para un lector de
  -- pantalla y para la busqueda.
  caption    text,

  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE daily_report_images ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_daily_report_images_entry
  ON daily_report_images(entry_id, created_at);

CREATE INDEX IF NOT EXISTS idx_daily_report_images_report
  ON daily_report_images(report_id);

-- Se hereda de la entrada, que a su vez hereda del reporte: si puedes ver la
-- actividad, ves su evidencia.
CREATE POLICY "dri_select" ON daily_report_images FOR SELECT
  USING (
    entry_id IN (
      SELECT e.id FROM daily_report_entries e
      JOIN daily_reports r ON r.id = e.report_id
      WHERE r.profile_id = auth.uid()
    )
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
    OR EXISTS (
      SELECT 1
      FROM daily_report_entries e
      JOIN daily_reports r      ON r.id = e.report_id
      JOIN workspace_members wm ON wm.workspace_id = r.workspace_id
      WHERE e.id          = daily_report_images.entry_id
        AND wm.profile_id = auth.uid()
        AND wm.role IN ('owner','admin')
    )
  );

-- Escribir y borrar evidencia: solo el dueño del reporte. Un admin puede LEER
-- el dia de alguien mas, no editarlo.
CREATE POLICY "dri_insert" ON daily_report_images FOR INSERT
  WITH CHECK (
    entry_id IN (
      SELECT e.id FROM daily_report_entries e
      JOIN daily_reports r ON r.id = e.report_id
      WHERE r.profile_id = auth.uid()
    )
  );

CREATE POLICY "dri_delete" ON daily_report_images FOR DELETE
  USING (
    entry_id IN (
      SELECT e.id FROM daily_report_entries e
      JOIN daily_reports r ON r.id = e.report_id
      WHERE r.profile_id = auth.uid()
    )
  );

-- ── 3. Bucket privado ────────────────────────────────────────────────────────
-- Privado y servido solo por signed URL, como chat-files y task-files.
--
-- Tope de 1.5MB por objeto: NO es el tamaño de lo que el usuario elige, es el
-- tamaño de lo que el navegador ya comprimio. Una captura de pantalla de 1600px
-- en WebP ronda los 150-250KB; 1.5MB deja margen de sobra y a la vez hace
-- imposible subir un original de celular sin pasar por la compresion.
--
-- Formatos: solo WebP y JPEG.
--   - Sin SVG: puede llevar script, y aunque el bucket sea privado no vale la
--     pena el riesgo por un formato que aqui no aporta nada.
--   - Sin GIF: los animados pesan como un video y no se pueden miniaturizar de
--     forma util. Un GIF de 8MB en un tablero es justo lo que se quiere evitar.
--   - PNG entra solo como respaldo de codificacion: si el navegador no sabe
--     escribir WebP, el cliente cae a JPEG. PNG queda fuera porque para una
--     captura pesa 3 o 4 veces mas que el mismo WebP.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'daily-report-images',
  'daily-report-images',
  false,
  1572864, -- 1.5MB
  ARRAY['image/webp','image/jpeg']
) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE daily_report_images IS
  'Evidencia en imagen de una actividad del reporte diario. Se guarda miniatura y version completa por separado: el listado solo baja miniaturas.';

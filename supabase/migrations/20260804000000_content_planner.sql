-- ─────────────────────────────────────────────────────────────────────────────
-- PLANIFICADOR DE CONTENIDO: galeria de lo que se va a publicar.
--
-- Hoy el contenido se aprueba por chat: alguien manda la imagen, otro contesta
-- "cambiale el texto", y tres dias despues nadie sabe si esa version se corrigio
-- ni si ya se publico. Lo que se pierde no es el archivo, es el ESTADO.
--
-- Por eso el modelo es de tres estados y nada mas:
--
--   por_aprobar  se subio, espera veredicto.
--   aprobado     alguien con mando dijo que si. Listo para salir.
--   publicado    ya salio. Se guarda a donde salio y cuando.
--
-- Tres tablas, cada una con una sola razon de existir:
--
--   content_items   la pieza. Su red social, su copy, su estado, su calificacion.
--   content_assets  las imagenes de esa pieza (la galeria).
--   content_notes   las correcciones pedidas y su resolucion.
--
-- ── Por que las correcciones son una tabla y no un campo de texto ────────────
-- "Pedir correcciones" y "trabajar en adecuaciones" son el mismo objeto visto
-- dos veces: una peticion abierta y esa misma peticion cerrada. Con un campo de
-- texto se machaca la anterior y se pierde el historial de que se pidio; con
-- filas se puede mostrar "faltan 2 correcciones por atender", que es lo unico
-- que de verdad mueve el trabajo.
--
-- ── Egress: por que cada imagen se guarda dos veces ─────────────────────────
-- Una galeria es el peor caso posible de egress: muchas imagenes visibles a la
-- vez. Con 40 piezas a 1MB cada visita se baja 40MB. Por eso, igual que en
-- daily_report_images:
--
--   thumb_path  miniatura (~400px, decenas de KB). Es lo UNICO que baja la
--               galeria, y se firma en lote al render.
--   path        version completa (~1600px). Solo sale de storage cuando alguien
--               abre la pieza.
--
-- La compresion ocurre en el NAVEGADOR (canvas -> WebP) antes de subir, asi que
-- el original de 6MB nunca llega a storage: se ahorra en subida, en
-- almacenamiento y en bajada a la vez. Los topes del bucket son la red que
-- impide que un cliente manipulado suba el original crudo.
--
-- ── Landmines de este repo, respetadas ───────────────────────────────────────
--   - FK solo a tablas hoja (workspaces, profiles) y de hijo a su padre directo.
--     Un solo camino entre cada par de tablas, sin ciclos -> sin HTTP 300 de
--     PostgREST en los embeds.
--   - Ninguna policy RLS consulta su PROPIA tabla -> sin recursion 42P17.
--   - Sin guion largo en comentarios.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. La pieza de contenido ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_items (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  title        text        NOT NULL,
  -- El copy que de verdad se va a publicar. Se guarda aparte del titulo porque
  -- el titulo es para encontrar la pieza en el tablero y el copy es el producto.
  caption      text,

  -- Red social. SIN check constraint a proposito: el catalogo vive en
  -- src/lib/content/catalog.ts y viaja con el deploy, igual que el catalogo de
  -- features. Agregar una red no deberia exigir una migracion, y una clave vieja
  -- que sobre se ignora al leer. La API valida contra el catalogo de codigo.
  network      text        NOT NULL,
  -- Formato dentro de esa red (post, reel, historia, carrusel). Mismo criterio.
  format       text,

  -- Los tres estados del tablero. Aqui SI hay check: no son un catalogo que
  -- crezca, son el corazon de la herramienta. Un cuarto estado inventado por un
  -- cliente con bug dejaria piezas invisibles en las tres columnas.
  status       text        NOT NULL DEFAULT 'por_aprobar'
                 CHECK (status IN ('por_aprobar','aprobado','publicado')),

  -- Calificacion de 1 a 5. Opcional: obligar a calificar para aprobar haria que
  -- todo el mundo ponga 5 para poder avanzar, y el dato dejaria de servir.
  rating       int         CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),

  -- Cuando se planea publicar. Fecha y no timestamp: el contenido se planea por
  -- dia, y una hora exacta que nadie respeta solo genera falsos retrasos.
  scheduled_for date,

  -- Se llenan al pasar a 'publicado'. La URL es la prueba de que salio.
  published_at  timestamptz,
  published_url text,

  -- Quien aprobo y cuando. Sin esto, "aprobado" es un estado sin responsable.
  approved_by  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  approved_at  timestamptz,

  created_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;

-- El tablero siempre se lee filtrando por workspace y agrupando por estado.
CREATE INDEX IF NOT EXISTS idx_content_items_board
  ON content_items(workspace_id, status, created_at DESC);

-- El filtro por red social es el segundo corte mas usado.
CREATE INDEX IF NOT EXISTS idx_content_items_network
  ON content_items(workspace_id, network);

-- ── 2. Las imagenes de la pieza (la galeria) ─────────────────────────────────

CREATE TABLE IF NOT EXISTS content_assets (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid        NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,

  -- Rutas dentro del bucket privado. NUNCA URLs: una URL firmada caduca, y
  -- guardarla seria almacenar basura con fecha de caducidad.
  path       text        NOT NULL,
  thumb_path text        NOT NULL,

  -- Dimensiones de la version completa, para reservar el espacio en pantalla
  -- antes de que cargue y no provocar salto de layout (CLS).
  width      int,
  height     int,

  bytes       int        NOT NULL CHECK (bytes > 0),
  thumb_bytes int        NOT NULL CHECK (thumb_bytes > 0),

  -- Orden dentro del carrusel. Lo decide quien sube, no la fecha: en un carrusel
  -- el orden ES el contenido.
  position   int         NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE content_assets ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_content_assets_item
  ON content_assets(item_id, position);

-- ── 3. Correcciones y adecuaciones ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS content_notes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id    uuid        NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  author_id  uuid        REFERENCES profiles(id) ON DELETE SET NULL,

  body       text        NOT NULL,

  -- 'correccion' es lo unico que exige accion de alguien; 'nota' es contexto.
  -- Separarlas es lo que permite contar "cuantas correcciones faltan" sin que el
  -- numero se contamine con comentarios sueltos.
  kind       text        NOT NULL DEFAULT 'correccion'
               CHECK (kind IN ('correccion','nota')),

  -- Se marca cuando la correccion quedo atendida. Null = pendiente.
  resolved_at timestamptz,
  resolved_by uuid       REFERENCES profiles(id) ON DELETE SET NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE content_notes ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_content_notes_item
  ON content_notes(item_id, created_at);

-- Cuenta de correcciones pendientes por pieza, que es lo que pinta el badge.
CREATE INDEX IF NOT EXISTS idx_content_notes_pending
  ON content_notes(item_id) WHERE resolved_at IS NULL;

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
-- El contenido a publicar es material de trabajo del equipo, no un diario
-- personal: cualquier miembro del workspace lo ve y puede colaborar. Lo que NO
-- es de cualquiera es APROBAR y PUBLICAR; esa regla la aplica la API con el
-- service role (mismo criterio que connector_registry), porque depende del rol
-- en el workspace y meterla aqui obligaria a subqueries mas caras en cada lectura.
--
-- Todas las subqueries van a workspace_members o a content_items (OTRAS tablas),
-- nunca a si misma -> sin recursion 42P17.

CREATE POLICY "ci_select" ON content_items FOR SELECT
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm WHERE wm.profile_id = auth.uid()
    )
  );

CREATE POLICY "ci_insert" ON content_items FOR INSERT
  WITH CHECK (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm WHERE wm.profile_id = auth.uid()
    )
  );

CREATE POLICY "ci_update" ON content_items FOR UPDATE
  USING (
    workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm WHERE wm.profile_id = auth.uid()
    )
  );

-- Borrar la pieza: solo quien la creo o un mando del workspace. Una pieza
-- borrada por error se lleva sus imagenes y su historial de correcciones.
CREATE POLICY "ci_delete" ON content_items FOR DELETE
  USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = content_items.workspace_id
        AND wm.profile_id   = auth.uid()
        AND wm.role IN ('owner','admin')
    )
  );

-- Los hijos heredan de la pieza: si puedes ver la pieza, ves sus imagenes y sus
-- correcciones.
CREATE POLICY "ca_select" ON content_assets FOR SELECT
  USING (item_id IN (SELECT id FROM content_items));

CREATE POLICY "ca_insert" ON content_assets FOR INSERT
  WITH CHECK (item_id IN (SELECT id FROM content_items));

CREATE POLICY "ca_delete" ON content_assets FOR DELETE
  USING (item_id IN (SELECT id FROM content_items));

CREATE POLICY "cn_select" ON content_notes FOR SELECT
  USING (item_id IN (SELECT id FROM content_items));

CREATE POLICY "cn_insert" ON content_notes FOR INSERT
  WITH CHECK (item_id IN (SELECT id FROM content_items));

CREATE POLICY "cn_update" ON content_notes FOR UPDATE
  USING (item_id IN (SELECT id FROM content_items));

-- ── 5. Bucket privado ────────────────────────────────────────────────────────
-- Privado y servido solo por signed URL, igual que daily-report-images.
--
-- Tope de 1.5MB por objeto: NO es el tamaño de lo que el usuario elige, es el
-- tamaño de lo que el navegador YA comprimio. Una imagen de 1600px en WebP ronda
-- los 150-250KB; 1.5MB deja margen de sobra y a la vez hace imposible subir un
-- original de celular sin pasar por la compresion.
--
-- Solo WebP y JPEG. Sin SVG (puede llevar script) y sin GIF (los animados pesan
-- como un video y no se miniaturizan de forma util).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'content-assets',
  'content-assets',
  false,
  1572864, -- 1.5MB
  ARRAY['image/webp','image/jpeg']
) ON CONFLICT (id) DO NOTHING;

-- ── 6. Herramientas instalables (gancho del marketplace) ─────────────────────
-- El planificador no le sirve a todos los workspaces, asi que no debe aparecerle
-- a todos. Aqui esta la diferencia con hidden_features:
--
--   hidden_features (workspace_members)  deny-list POR PERSONA. Una pantalla
--       nueva le aparece a todos y el admin la esconde a quien no la necesita.
--   installed_features (workspaces)      allow-list POR WORKSPACE. Una
--       herramienta instalable NO existe hasta que alguien la instala.
--
-- Se usa una columna de arreglo y no una tabla nueva por dos razones: el layout
-- del workspace YA consulta `workspaces`, asi que instalar no cuesta ni una
-- consulta extra (esto es egress que no se paga), y el catalogo sigue siendo
-- codigo, igual que features.ts. Una clave vieja que sobre se ignora al leer.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS installed_features text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.workspaces.installed_features IS
  'Claves de herramientas instalables (src/lib/features.ts, installable: true) activas en este workspace. Vacio = ninguna instalada. Es allow-list, al reves de workspace_members.hidden_features.';

COMMENT ON TABLE content_items IS
  'Pieza de contenido a publicar, con su red social y su estado (por_aprobar, aprobado, publicado).';
COMMENT ON TABLE content_assets IS
  'Imagenes de una pieza. Miniatura y version completa por separado: la galeria solo baja miniaturas.';
COMMENT ON TABLE content_notes IS
  'Correcciones pedidas sobre una pieza y su resolucion. resolved_at null = pendiente.';

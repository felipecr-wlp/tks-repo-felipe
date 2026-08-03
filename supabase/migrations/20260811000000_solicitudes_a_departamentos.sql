-- ─────────────────────────────────────────────────────────────────────────────
-- SOLICITUDES (tickets) a departamentos y a la direccion.
--
-- El problema real: hoy pedir algo (una mejora de software, un desarrollo, una
-- compra, un permiso) se hace por chat o de palabra. Lo que se pierde no es la
-- peticion, es la DECISION: quien dijo que si, para cuando, y quien quedo a
-- cargo. Un mes despues nadie sabe si aquello se rechazo o simplemente se
-- olvido, y las dos cosas se ven exactamente igual desde afuera.
--
-- Por eso el corazon de esta tabla no es el texto de la peticion, son las tres
-- columnas de la decision: `status`, `decision_note` y `decided_by`. Una
-- solicitud rechazada CON motivo escrito es informacion. Una que se queda en
-- 'solicitado' para siempre es la version silenciosa de rechazarla, y el tablero
-- la deja a la vista justamente para que eso incomode.
--
-- ── El flujo, en una linea ───────────────────────────────────────────────────
--
--   solicitado ──canalizar──> canalizado ──arrancar──> en_proceso ──> resuelto
--       │                                                   │
--       └──rechazar──> rechazado          cancelar (el solicitante) ──> cancelado
--
-- "Canalizar" es la palabra del negocio y es literal: el admin decide A QUIEN le
-- toca. Una solicitud canalizada sin destino no existe; la regla la aplica
-- src/lib/tickets/flujo-solicitud.ts (`exigeDestino`), que es tabla y no ifs.
--
-- ── Tres tablas, cada una con una sola razon de existir ──────────────────────
--   tickets          la peticion, su destino y su decision.
--   ticket_comments  el hilo: comentarios y respuestas. Es el intercambio de
--                    ideas, no un campo de notas que se machaca.
--   ticket_watchers  a quien mas se involucro. Sin esto, meter a un tercero
--                    obliga a reenviarle todo por chat y el hilo se parte.
--
-- ── Lo que NO se creo, y por que ─────────────────────────────────────────────
-- No hay bucket nuevo. Los adjuntos comprimidos (ZIP, RAR, 7z) ya caben en
-- `chat-files`, que ese permiso ya lo tiene desde 20260720520000. Crear un
-- bucket paralelo seria un segundo lugar donde buscar el mismo archivo.
--
-- ── Landmines de este repo, respetadas ───────────────────────────────────────
--   - FK de hijo a padre directo y a tablas hoja (workspaces, profiles, spaces,
--     tasks). Un solo camino entre cada par -> sin HTTP 300 de PostgREST.
--     Excepcion consciente: `tickets` tiene TRES FK a profiles (requested_by,
--     assignee_id, decided_by), igual que content_items. Por eso todo embed a
--     profiles desde aqui DEBE nombrar la constraint.
--   - Ninguna policy RLS consulta su PROPIA tabla -> sin recursion 42P17.
--   - Sin guion largo en comentarios.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. La solicitud ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tickets (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Numero visible por workspace (#1, #2, #3). Existe porque la gente se refiere
  -- a las cosas hablando: "la 14" se dice, un uuid no. Lo asigna un trigger.
  numero       int         NOT NULL,

  title        text        NOT NULL,
  -- Que se pide y por que. El "por que" es lo que permite decidir sin una junta.
  body         text,

  -- Tipo de peticion (software, desarrollo, compra, proceso...). SIN check a
  -- proposito, mismo criterio que content_items.network: el catalogo vive en
  -- src/lib/tickets/catalogo.ts y viaja con el deploy. Agregar un tipo no
  -- deberia exigir una migracion, y una clave vieja que sobre se ignora al leer.
  kind         text        NOT NULL DEFAULT 'otro',

  -- Aqui SI hay check: la urgencia ordena el tablero. Un valor inventado por un
  -- cliente con bug dejaria la solicitud fuera de todos los ordenamientos.
  priority     text        NOT NULL DEFAULT 'normal'
                 CHECK (priority IN ('baja','normal','alta','urgente')),

  status       text        NOT NULL DEFAULT 'solicitado'
                 CHECK (status IN ('solicitado','canalizado','en_proceso','resuelto','rechazado','cancelado')),

  -- A que departamento va dirigida. NULL = a la direccion (el admin). Se permite
  -- NULL porque obligar a elegir departamento haria que la gente adivine, y una
  -- solicitud mal dirigida es peor que una sin dirigir: la primera se queda
  -- esperando en la bandeja equivocada.
  space_id     uuid        REFERENCES spaces(id) ON DELETE SET NULL,

  requested_by uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  -- Quien quedo a cargo al canalizar. Es el destino concreto de "canalizar".
  assignee_id  uuid        REFERENCES profiles(id) ON DELETE SET NULL,

  -- Para cuando la necesita QUIEN LA PIDE. Es un deseo, no un compromiso.
  needed_by    date,
  -- Para cuando se comprometio QUIEN LA VA A HACER. Separadas a proposito: si
  -- fueran la misma columna, aceptar una solicitud borraria la fecha que se
  -- pidio y nadie podria ver que se prometio un mes despues de lo necesario.
  due_date     date,

  -- Enlaces de referencia (un Figma, un doc, un video del problema). Arreglo de
  -- objetos {url, label}. jsonb y no tabla: no se consultan ni se filtran, solo
  -- se pintan junto a la solicitud.
  links        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  -- Adjuntos ya subidos a `chat-files`: {path, name, size, mime}.
  attachments  jsonb       NOT NULL DEFAULT '[]'::jsonb,

  -- La decision. Sin estas tres columnas esto seria un buzon, no un proceso.
  decision_note text,
  decided_by    uuid       REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at    timestamptz,

  -- Si al canalizar se creo una tarea, aqui queda el puente. ON DELETE SET NULL
  -- porque borrar la tarea no deberia borrar la historia de que se pidio.
  task_id      uuid        REFERENCES tasks(id) ON DELETE SET NULL,

  closed_at    timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (workspace_id, numero)
);
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;

-- El tablero siempre lee por workspace y agrupa por estado.
CREATE INDEX IF NOT EXISTS idx_tickets_board
  ON tickets(workspace_id, status, created_at DESC);

-- "Lo que me toca a mi" y "lo que pedi yo" son las dos vistas personales.
CREATE INDEX IF NOT EXISTS idx_tickets_assignee  ON tickets(assignee_id)  WHERE assignee_id  IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_requester ON tickets(requested_by) WHERE requested_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_space     ON tickets(space_id)     WHERE space_id     IS NOT NULL;

-- ── Numero consecutivo por workspace ─────────────────────────────────────────
-- El advisory lock NO es paranoia: sin el, dos personas que mandan una solicitud
-- en el mismo segundo calculan el mismo MAX+1 y la segunda revienta contra el
-- UNIQUE, con un error que no explica nada. El lock es por workspace y se suelta
-- solo al cerrar la transaccion, asi que no bloquea a los demas workspaces.
CREATE OR REPLACE FUNCTION tickets_asigna_numero()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('tickets:' || NEW.workspace_id::text));
    SELECT COALESCE(MAX(t.numero), 0) + 1 INTO NEW.numero
      FROM tickets t WHERE t.workspace_id = NEW.workspace_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tickets_numero ON tickets;
CREATE TRIGGER trg_tickets_numero
  BEFORE INSERT ON tickets
  FOR EACH ROW EXECUTE FUNCTION tickets_asigna_numero();

-- `numero` es NOT NULL pero el trigger lo llena, asi que el cliente inserta sin
-- el. Se le da un default de 0 para que el NOT NULL no rechace la fila antes de
-- que corra el BEFORE INSERT.
ALTER TABLE tickets ALTER COLUMN numero SET DEFAULT 0;

DROP TRIGGER IF EXISTS trg_tickets_updated_at ON tickets;
CREATE TRIGGER trg_tickets_updated_at
  BEFORE UPDATE ON tickets
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── 2. El hilo ───────────────────────────────────────────────────────────────
-- Un comentario puede colgar de otro (parent_id). Un solo nivel: la API aplana
-- la respuesta de una respuesta al mismo padre. Los hilos de profundidad libre
-- se ven bien en el diseño y en la practica producen conversaciones que nadie
-- puede seguir en un telefono.

CREATE TABLE IF NOT EXISTS ticket_comments (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id  uuid        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  author_id  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  -- Autorreferencia. No es un ciclo entre tablas distintas: PostgREST resuelve
  -- el self-FK sin ambiguedad, y de todas formas el hilo se arma en JS a partir
  -- de una lista plana, sin embed recursivo.
  parent_id  uuid        REFERENCES ticket_comments(id) ON DELETE CASCADE,

  body       text        NOT NULL,
  attachments jsonb      NOT NULL DEFAULT '[]'::jsonb,

  -- Marca los comentarios que registran un cambio de estado ("canalizada a
  -- Marketing", "rechazada porque..."). Se guardan como comentarios y no en una
  -- bitacora aparte para que la conversacion y las decisiones se lean en el
  -- MISMO hilo, en orden. Partirlas en dos listas es como se pierde el contexto.
  is_system  boolean     NOT NULL DEFAULT false,

  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at  timestamptz
);
ALTER TABLE ticket_comments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ticket_comments_ticket
  ON ticket_comments(ticket_id, created_at);

-- ── 3. Involucrados ──────────────────────────────────────────────────────────
-- "Poder involucrar a mas personas" es esta tabla. Un observador ve la
-- solicitud, comenta y recibe aviso, pero no decide: decidir sigue siendo del
-- admin y hacer sigue siendo del responsable.

CREATE TABLE IF NOT EXISTS ticket_watchers (
  ticket_id  uuid        NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  profile_id uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ticket_id, profile_id)
);
ALTER TABLE ticket_watchers ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_ticket_watchers_profile ON ticket_watchers(profile_id);

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
-- Una solicitud NO es publica para todo el workspace, al reves que el
-- planificador de contenido. La razon es el contenido tipico: "el sistema de
-- nomina esta calculando mal", "necesito una licencia porque la mia caduco". Es
-- material de trabajo, pero dirigido.
--
-- Ve una solicitud quien tiene un motivo nombrable para verla:
--   quien la pidio, quien quedo a cargo, quien fue involucrado,
--   los miembros del departamento al que se dirigio, y los mandos.
--
-- Igual que en el resto del repo, las rutas /api usan el service role y se
-- saltan RLS: el candado REAL es src/lib/tickets/acceso.ts y esto es la red de
-- abajo. Todas las subqueries van a OTRAS tablas -> sin 42P17.

CREATE POLICY "tickets_select" ON tickets FOR SELECT
  USING (
    requested_by = auth.uid()
    OR assignee_id = auth.uid()
    OR EXISTS (SELECT 1 FROM ticket_watchers w
                WHERE w.ticket_id = tickets.id AND w.profile_id = auth.uid())
    OR (space_id IS NOT NULL AND is_space_member(space_id))
    OR (SELECT p.org_role FROM profiles p WHERE p.id = auth.uid()) IN ('owner','admin')
    OR EXISTS (SELECT 1 FROM workspace_members wm
                WHERE wm.workspace_id = tickets.workspace_id
                  AND wm.profile_id = auth.uid()
                  AND wm.role IN ('owner','admin'))
  );

-- Crear: cualquier miembro del workspace, y solo a nombre propio. Pedir cosas es
-- de todos; si hiciera falta permiso para pedir, el modulo no serviria de nada.
CREATE POLICY "tickets_insert" ON tickets FOR INSERT
  WITH CHECK (
    requested_by = auth.uid()
    AND workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm WHERE wm.profile_id = auth.uid()
    )
  );

CREATE POLICY "tickets_update" ON tickets FOR UPDATE
  USING (
    requested_by = auth.uid()
    OR assignee_id = auth.uid()
    OR (SELECT p.org_role FROM profiles p WHERE p.id = auth.uid()) IN ('owner','admin')
    OR EXISTS (SELECT 1 FROM workspace_members wm
                WHERE wm.workspace_id = tickets.workspace_id
                  AND wm.profile_id = auth.uid()
                  AND wm.role IN ('owner','admin'))
  );

-- Borrar NO es de cualquiera, ni siquiera de quien la pidio: una solicitud
-- rechazada que su autor puede borrar convierte el historial en algo opcional.
-- Para arrepentirse esta 'cancelado', que deja rastro.
CREATE POLICY "tickets_delete" ON tickets FOR DELETE
  USING (
    (SELECT p.org_role FROM profiles p WHERE p.id = auth.uid()) IN ('owner','admin')
  );

-- Los hijos heredan de la solicitud: si la ves, ves su hilo y sus involucrados.
CREATE POLICY "tc_select" ON ticket_comments FOR SELECT
  USING (ticket_id IN (SELECT id FROM tickets));
CREATE POLICY "tc_insert" ON ticket_comments FOR INSERT
  WITH CHECK (ticket_id IN (SELECT id FROM tickets) AND author_id = auth.uid());
CREATE POLICY "tc_update" ON ticket_comments FOR UPDATE
  USING (author_id = auth.uid());
CREATE POLICY "tc_delete" ON ticket_comments FOR DELETE
  USING (author_id = auth.uid());

CREATE POLICY "tw_select" ON ticket_watchers FOR SELECT
  USING (ticket_id IN (SELECT id FROM tickets));
CREATE POLICY "tw_insert" ON ticket_watchers FOR INSERT
  WITH CHECK (ticket_id IN (SELECT id FROM tickets));
CREATE POLICY "tw_delete" ON ticket_watchers FOR DELETE
  USING (ticket_id IN (SELECT id FROM tickets));

-- ── 5. Bucket privado para los adjuntos ──────────────────────────────────────
-- Privado y servido solo por signed URL, igual que chat-files y task-files.
--
-- Por que un bucket propio y no `chat-files`: la ruta de subida de chat valida
-- que el objeto viva bajo `team/<id>/` y resuelve el permiso con
-- canAccessTeamById. Meter aqui archivos de solicitudes obligaria a debilitar
-- esa validacion, que es justo el tipo de cambio que rompe algo lejano. Un
-- bucket por dominio de permiso.
--
-- ── El landmine de los comprimidos ───────────────────────────────────────────
-- "Adjuntos comprimidos" suena a un solo MIME y son cuatro. Chrome en Windows
-- reporta un .zip como `application/x-zip-compressed`, NO como `application/zip`
-- (por lo que dice el registro de Windows), y para .rar y .7z a veces manda
-- cadena vacia. Si la lista solo trajera 'application/zip', subir un ZIP desde
-- una maquina Windows fallaria con un error de storage que no menciona el MIME
-- por ningun lado. Por eso van los cuatro alias, y ademas la API normaliza el
-- tipo por extension cuando el navegador no manda ninguno.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ticket-files',
  'ticket-files',
  false,
  52428800, -- 50MB. Un ZIP con capturas y logs pasa de 25MB con facilidad.
  ARRAY[
    -- Comprimidos, con los alias que de verdad manda el navegador.
    'application/zip','application/x-zip-compressed','multipart/x-zip',
    'application/x-rar-compressed','application/vnd.rar',
    'application/x-7z-compressed','application/gzip','application/x-tar',
    -- Lo demas que se adjunta a una peticion: capturas y documentos.
    'image/png','image/jpeg','image/gif','image/webp',
    'application/pdf',
    'text/plain','text/csv','text/markdown','application/json',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
) ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE tickets IS
  'Solicitudes a departamentos o a la direccion. El admin canaliza (asigna destino y responsable) o rechaza con motivo.';
COMMENT ON TABLE ticket_comments IS
  'Hilo de una solicitud: comentarios, respuestas (parent_id) y los cambios de estado marcados con is_system.';
COMMENT ON TABLE ticket_watchers IS
  'Personas involucradas en una solicitud ademas del solicitante y el responsable. Ven y comentan, no deciden.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Academia WLP. Aditivo. No toca ninguna tabla existente.
--
-- Modelo: el CONTENIDO de los cursos vive en codigo (src/lib/academy/courses.ts),
-- versionado. La BD solo guarda datos DINAMICOS por persona:
--   * academy_access          -> a que cursos tiene acceso cada quien.
--   * academy_access_requests  -> solicitudes de acceso (flujo pedir -> aprobar).
--   * academy_progress         -> avance y puntaje por modulo.
--   * academy_certificates     -> certificados emitidos por curso.
--
-- course_id / module_id son TEXT (ids de contenido-como-codigo): NO hay FK a
-- una tabla de cursos porque no existe (evita ademas cualquier ciclo de FK).
-- El unico FK es a profiles(id). La seguridad se ancla en la persona
-- (profile_id = auth.uid()) con bypass para admin/owner de la org.
--
-- LANDMINES respetadas:
--   * Ningun FK que cierre ciclo entre tablas ya relacionadas.
--   * Ninguna policy RLS con subquery a su PROPIA tabla (sin recursion 42P17):
--     todas las subqueries apuntan a `profiles`, tabla distinta.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── academy_access: acceso concedido a un curso ──────────────────────────────
CREATE TABLE IF NOT EXISTS academy_access (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id   text        NOT NULL CHECK (char_length(course_id) BETWEEN 1 AND 64),
  granted_by  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, course_id)
);
ALTER TABLE academy_access ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_academy_access_profile ON academy_access(profile_id);
ALTER TABLE academy_access REPLICA IDENTITY FULL;

-- ── academy_access_requests: solicitud de acceso (pedir -> aprobar) ───────────
CREATE TABLE IF NOT EXISTS academy_access_requests (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id   text        NOT NULL CHECK (char_length(course_id) BETWEEN 1 AND 64),
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected')),
  note        text        CHECK (note IS NULL OR char_length(note) <= 500),
  decided_by  uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  decided_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE academy_access_requests ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_academy_req_profile ON academy_access_requests(profile_id);
CREATE INDEX IF NOT EXISTS idx_academy_req_status ON academy_access_requests(status);
-- Una sola solicitud PENDIENTE por (persona, curso). Aprobadas/rechazadas no chocan.
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_req_pending
  ON academy_access_requests(profile_id, course_id)
  WHERE status = 'pending';
ALTER TABLE academy_access_requests REPLICA IDENTITY FULL;

-- ── academy_progress: avance por modulo ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_progress (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id   text        NOT NULL CHECK (char_length(course_id) BETWEEN 1 AND 64),
  module_id   text        NOT NULL CHECK (char_length(module_id) BETWEEN 1 AND 64),
  score       integer     NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  completed   boolean     NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, course_id, module_id)
);
ALTER TABLE academy_progress ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_academy_progress_profile ON academy_progress(profile_id, course_id);
ALTER TABLE academy_progress REPLICA IDENTITY FULL;

-- ── academy_certificates: certificado por curso ──────────────────────────────
CREATE TABLE IF NOT EXISTS academy_certificates (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  course_id   text        NOT NULL CHECK (char_length(course_id) BETWEEN 1 AND 64),
  code        text        NOT NULL UNIQUE,
  score       integer     NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
  issued_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, course_id)
);
ALTER TABLE academy_certificates ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_academy_cert_profile ON academy_certificates(profile_id);
ALTER TABLE academy_certificates REPLICA IDENTITY FULL;

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- Patron seguro (identico a `goals`): fila propia (profile_id = auth.uid())
-- o admin/owner de la org. Subqueries siempre a `profiles` (otra tabla) -> sin
-- recursion.

-- academy_access: lectura propia o admin; ESCRITURA solo admin (nadie se
-- auto-concede acceso: para eso existen las solicitudes).
CREATE POLICY "academy_access_select" ON academy_access FOR SELECT
  USING (
    profile_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );
CREATE POLICY "academy_access_write" ON academy_access FOR ALL
  USING ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- academy_access_requests: lectura propia o admin; el usuario puede CREAR su
-- propia solicitud pendiente; solo admin decide (update/delete).
CREATE POLICY "academy_req_select" ON academy_access_requests FOR SELECT
  USING (
    profile_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );
CREATE POLICY "academy_req_insert" ON academy_access_requests FOR INSERT
  WITH CHECK (profile_id = auth.uid() AND status = 'pending');
CREATE POLICY "academy_req_update" ON academy_access_requests FOR UPDATE
  USING ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'));
CREATE POLICY "academy_req_delete" ON academy_access_requests FOR DELETE
  USING ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- academy_progress: fila propia o admin (lectura y escritura).
CREATE POLICY "academy_progress_select" ON academy_progress FOR SELECT
  USING (
    profile_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );
CREATE POLICY "academy_progress_write" ON academy_progress FOR ALL
  USING (
    profile_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  )
  WITH CHECK (
    profile_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- academy_certificates: fila propia o admin (lectura y escritura).
CREATE POLICY "academy_cert_select" ON academy_certificates FOR SELECT
  USING (
    profile_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );
CREATE POLICY "academy_cert_write" ON academy_certificates FOR ALL
  USING (
    profile_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  )
  WITH CHECK (
    profile_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );

-- ── Realtime (best effort) ───────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH t IN ARRAY ARRAY[
      'academy_access','academy_access_requests','academy_progress','academy_certificates'
    ] LOOP
      BEGIN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', t);
      EXCEPTION WHEN duplicate_object THEN NULL;
      END;
    END LOOP;
  END IF;
END $$;

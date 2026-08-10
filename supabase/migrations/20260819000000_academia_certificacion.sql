-- ─────────────────────────────────────────────────────────────────────────────
-- Certificacion de verdad: verificacion del supervisor, acuse de recibo y
-- CADUCIDAD. Aditivo.
--
-- POR QUE. Hoy la Academia solo sabe decir "vio el video". La plantilla de
-- modulo de Fred pide dos cosas mas, y son justo las que separan "vio" de
-- "esta certificado para hacerlo":
--
--   Supervisor verification -> alguien con nombre firma que la persona lo sabe
--                              HACER, no solo que le dio play.
--   Acknowledgment          -> la persona declara que lo entendio y se
--                              compromete. Esto es lo que se enseña en una
--                              auditoria o en una disputa.
--
-- Y una tercera que ningun documento pidio pero que un auditor SI pide: la
-- capacitacion de seguridad CADUCA. Lo que preguntan no es quien tomo el
-- curso, es quien lo tiene VIGENTE hoy.
--
-- MODELO. Una fila por (persona, item). `item_type` distingue curso de video
-- sin necesitar dos tablas gemelas; `item_id` es TEXT porque los cursos ya
-- viven como contenido-como-codigo con id de texto (misma decision que
-- academy_progress) y los videos son uuid en texto.
--
-- POR QUE NO SE AGREGA A academy_certificates. Esa tabla es "aprobo el quiz":
-- se emite sola. Esto es un acto humano con nombre y fecha, y mezclarlos haria
-- que emitir un certificado automatico pisara la firma de un supervisor.
--
-- LANDMINES: sin ciclos de FK; RLS sin subquery a su propia tabla.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS academy_certifications (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  item_type     text        NOT NULL CHECK (item_type IN ('course','video')),
  item_id       text        NOT NULL CHECK (char_length(item_id) BETWEEN 1 AND 64),

  -- ── Acuse de la persona ────────────────────────────────────────────────
  acknowledged_at   timestamptz,
  /** Lo que la persona acepto, GUARDADO TAL CUAL. */
  acknowledged_text text CHECK (acknowledged_text IS NULL OR char_length(acknowledged_text) <= 2000),

  -- ── Firma del supervisor ───────────────────────────────────────────────
  verified_by   uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  verified_at   timestamptz,
  verified_note text        CHECK (verified_note IS NULL OR char_length(verified_note) <= 1000),

  -- ── Vigencia ───────────────────────────────────────────────────────────
  /** NULL = no caduca. Con fecha, deja de estar vigente al pasarla. */
  expires_at    timestamptz,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_id, item_type, item_id)
);
ALTER TABLE academy_certifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_acad_cert_profile ON academy_certifications(profile_id);
CREATE INDEX IF NOT EXISTS idx_acad_cert_item ON academy_certifications(item_type, item_id);
-- Para "quien se me vence este mes", que es la consulta que de verdad se hace.
CREATE INDEX IF NOT EXISTS idx_acad_cert_expira ON academy_certifications(expires_at)
  WHERE expires_at IS NOT NULL;
ALTER TABLE academy_certifications REPLICA IDENTITY FULL;

-- Cada quien ve lo suyo; admin ve y administra todo.
CREATE POLICY "acad_cert_select" ON academy_certifications FOR SELECT
  USING (
    profile_id = auth.uid()
    OR (SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin')
  );
-- El acuse lo hace la propia persona (INSERT/UPDATE de su fila).
CREATE POLICY "acad_cert_insert_propio" ON academy_certifications FOR INSERT
  WITH CHECK (profile_id = auth.uid());
CREATE POLICY "acad_cert_update_propio" ON academy_certifications FOR UPDATE
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());
-- La firma del supervisor y la vigencia, solo admin.
CREATE POLICY "acad_cert_admin" ON academy_certifications FOR ALL
  USING ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ── Reglas por contenido: que exige y cada cuanto caduca ─────────────────────
ALTER TABLE academy_videos
  ADD COLUMN IF NOT EXISTS requires_ack boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS requires_verification boolean NOT NULL DEFAULT false,
  /** Meses de vigencia. NULL = no caduca. */
  ADD COLUMN IF NOT EXISTS valid_months integer
    CHECK (valid_months IS NULL OR (valid_months BETWEEN 1 AND 120)),
  /** Texto que la persona acepta. NULL = se usa el generico. */
  ADD COLUMN IF NOT EXISTS ack_text text CHECK (ack_text IS NULL OR char_length(ack_text) <= 2000);

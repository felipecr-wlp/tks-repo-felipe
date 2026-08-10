-- ─────────────────────────────────────────────────────────────────────────────
-- Escuelas de WLP Academy (estructura de Fred, 2026-08-09). Aditivo.
--
-- MODELO: Escuela -> Stack -> Video. Una escuela agrupa VARIAS colecciones,
-- no una sola: la 700 (Yard) contiene YARD, FAB, EQP, FAC y ALAN. Por eso el
-- stack es la pieza intermedia y no se colapsa escuela = coleccion.
--
-- `code` es el numero de Fred como TEXTO ('00', '100', ... '1300'): '00' no
-- sobrevive como entero y el orden se lleva aparte en `position`.
--
-- OJO CON LA NUMERACION (choque real en el documento fuente): las escuelas
-- usan centenas y los NIVELES de curso tambien (100=Foundation,
-- 200=Intermediate). No colisionan porque el codigo del curso lo da el
-- prefijo de letras (RPA-101, ASPH-210), pero conviene no volver a usar el
-- numero de escuela dentro de un codigo de curso.
--
-- Borrar una escuela NO borra sus stacks (ON DELETE SET NULL): caen a
-- "sin escuela" igual que un video sin stack. Reorganizar no puede costar
-- contenido.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS academy_schools (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text        NOT NULL UNIQUE CHECK (char_length(code) BETWEEN 1 AND 8),
  title       text        NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description text        NOT NULL DEFAULT '' CHECK (char_length(description) <= 1000),
  accent      text        NOT NULL DEFAULT '#f59e0b' CHECK (char_length(accent) <= 16),
  -- Escuela 00: la completa todo el mundo. Se marca como dato, no como un if
  -- suelto en la UI, para que cualquier vista pueda preguntarlo.
  mandatory   boolean     NOT NULL DEFAULT false,
  position    integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE academy_schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_schools REPLICA IDENTITY FULL;

ALTER TABLE academy_stacks
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES academy_schools(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_academy_stacks_school ON academy_stacks(school_id, position);

CREATE POLICY "academy_schools_select" ON academy_schools FOR SELECT
  USING (auth.uid() IS NOT NULL);
CREATE POLICY "academy_schools_write" ON academy_schools FOR ALL
  USING ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'))
  WITH CHECK ((SELECT org_role FROM profiles WHERE id = auth.uid()) IN ('owner','admin'));

-- ── Las 14 escuelas, tal como las definio Fred ───────────────────────────────
-- ON CONFLICT DO NOTHING: correr la migracion dos veces no duplica ni pisa
-- ediciones posteriores de los titulos.
INSERT INTO academy_schools (code, title, description, accent, mandatory, position) VALUES
  ('00',   'Cultura, Misión y Operating System', 'WLP Core. La completa todo el mundo, sin excepción.', '#f59e0b', true,  0),
  ('100',  'Remote Paving Advisor',              'Revenue & Remote Operations.',                        '#3b82f6', false, 100),
  ('200',  'Field Paving Advisor',               'Field Operations: verificación, presencia y escalamiento.', '#0ea5e9', false, 200),
  ('300',  'Field Intelligence & Knowledge Capture', 'Capturar, preservar y transmitir el conocimiento de WLP.', '#8b5cf6', false, 300),
  ('400',  'Production & Construction',          'Construction Mastery: asfalto, concreto, sello, striping, ADA.', '#ef4444', false, 400),
  ('500',  'Estimating & Preconstruction',       'Donde se protege el margen antes de mover una máquina.', '#f97316', false, 500),
  ('600',  'Project Operations & Control Tower', 'Cómo viaja un proyecto por WLP, de venta a cobro.',   '#14b8a6', false, 600),
  ('700',  'Yard, Equipment & Fabrication',      'Patio, equipo, fabricación y mantenimiento.',          '#a3a3a3', false, 700),
  ('800',  'Customer Experience, Quality & Closeout', 'Zero Go-Back: calidad, cliente y cierre.',        '#10b981', false, 800),
  ('900',  'Safety, Compliance & Information Security', 'Seguridad en campo, cumplimiento y seguridad de la información.', '#dc2626', false, 900),
  ('1000', 'Leadership & Management',            'Para ser Lead no basta con rendir: hay que poder formar a otro.', '#6366f1', false, 1000),
  ('1100', 'People Operations & Recruiting',     'Cómo se contrata, se integra y se desarrolla la gente.', '#ec4899', false, 1100),
  ('1200', 'Legal Operations & Disputes',        'Contratos, disputas y operación legal.',               '#78716c', false, 1200),
  ('1300', 'Marketing & Demand Generation',      'Cómo llega la demanda y cómo se sostiene.',            '#eab308', false, 1300)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- SOP Nivel 2, Paso 2: aprobacion / firma de la version vigente.
--
-- Registra QUIEN aprobo (firmo) el SOP y CUANDO, sellando la version aprobada.
-- Si despues se publica una version nueva (sop_version cambia), la aprobacion
-- queda "desactualizada" (approved_version != sop_version) y debe re-firmarse.
-- Esto cierra el ciclo de gobernanza: un SOP "Activo" ahora tiene una firma
-- responsable, no solo un cambio de estatus.
--
-- LANDMINE respetada: `approved_by` es uuid SIN FK a propósito. La tabla notes YA
-- referencia profiles via created_by; agregar un SEGUNDO FK notes->profiles haría
-- AMBIGUO el embed `author:profiles(...)` que usan page.tsx y varias rutas ->
-- PostgREST devuelve HTTP 300 y el layout hace notFound() para TODAS las notas.
-- Por eso el perfil del aprobador se resuelve en la capa de API, no por embed.
-- Aditivo: solo columnas nullable, sin cambios de RLS.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS approved_by      uuid,
  ADD COLUMN IF NOT EXISTS approved_at      timestamptz,
  ADD COLUMN IF NOT EXISTS approved_version text;

COMMENT ON COLUMN notes.approved_by IS
  'Profile que aprobó/firmó la versión vigente del SOP. SIN FK: notes ya referencia profiles via created_by; un 2do FK haría ambiguo el embed author:profiles (HTTP 300). El perfil se resuelve en la API.';
COMMENT ON COLUMN notes.approved_version IS
  'Versión (sop_version) que fue aprobada. Si difiere de la vigente, la aprobación está desactualizada y debe re-firmarse.';

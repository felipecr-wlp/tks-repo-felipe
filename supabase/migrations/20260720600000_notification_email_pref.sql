-- ─────────────────────────────────────────────────────────────────────────────
-- Track 2, Circuito 2.B: preferencia por usuario para recibir correos de
-- notificaciones (menciones y asignaciones). Aditivo: columna nullable con
-- DEFAULT true (opt-in por defecto, el usuario puede optar por no recibir).
-- No toca RLS ni FKs: solo agrega una columna a profiles.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_notifications boolean NOT NULL DEFAULT true;

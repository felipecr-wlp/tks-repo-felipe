-- Nivel B: selector de metodología por equipo (Scrum <-> Kanban).
-- Aditivo y seguro: los equipos existentes quedan en 'scrum' por default,
-- así que el panel actual no cambia de comportamiento hasta que un admin
-- decida cambiar a Kanban. Sin borrado de datos, sin backfill destructivo.

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS methodology text NOT NULL DEFAULT 'scrum'
  CHECK (methodology IN ('scrum', 'kanban'));

COMMENT ON COLUMN teams.methodology IS
  'Metodología de trabajo del equipo: scrum (sprints) o kanban (flujo continuo). Cambiable solo por admin del equipo.';

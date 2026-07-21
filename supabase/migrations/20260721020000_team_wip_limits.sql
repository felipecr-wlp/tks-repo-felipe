-- Limites WIP por columna configurables por equipo.
-- Columna aditiva, nullable, sin FK ni cambios de RLS (segura, reversible).
--
-- Forma: jsonb { "todo": n, "in_progress": n, "done": n } con enteros 1..99.
-- Una categoria ausente o null = usar el limite sano derivado (2 por miembro),
-- que hoy solo aplica a "en curso". Solo aplica en vista Kanban.

alter table public.teams
  add column if not exists wip_limits jsonb;

comment on column public.teams.wip_limits is
  'Limites WIP por categoria de columna del tablero Kanban, ej. {"in_progress": 5}. null = limite sano derivado.';

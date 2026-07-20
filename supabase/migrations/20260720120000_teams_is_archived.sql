-- Equipos activables/desactivables. Un equipo archivado se oculta del sidebar
-- para los miembros regulares (solo lo ven los administradores del workspace,
-- que pueden reactivarlo). No se borra: preserva tareas, proyectos e historial.
alter table public.teams
  add column if not exists is_archived boolean not null default false;

create index if not exists teams_workspace_active_idx
  on public.teams (workspace_id)
  where is_archived = false;

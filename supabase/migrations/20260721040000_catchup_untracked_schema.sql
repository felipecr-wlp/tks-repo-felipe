-- Catch-up migration: reconcilia objetos que existen en produccion pero que
-- nunca quedaron en la cadena de migraciones rastreada. Sin esto, un rebuild
-- limpio de la base (arrancando en 20260421000000_initial_schema.sql) romperia
-- subtareas, estimaciones de tiempo y el registro de tiempo, porque estas
-- columnas y la tabla time_entries se agregaron fuera de banda.
--
-- Todo aqui es idempotente (IF NOT EXISTS / DROP..CREATE), asi que aplicarlo a
-- produccion es un no-op seguro: solo documenta el estado real para que un
-- entorno nuevo lo reproduzca fielmente.
--
-- Definiciones tomadas del esquema vivo (Supabase cmskiyypeujcgikbvyoz, 2026-07-21).

-- 1. Columnas de tasks agregadas fuera de banda -------------------------------
alter table public.tasks
  add column if not exists parent_task_id uuid references public.tasks(id) on delete cascade;

alter table public.tasks
  add column if not exists start_date timestamptz;

alter table public.tasks
  add column if not exists estimate_minutes integer;

create index if not exists tasks_parent_task_id_idx
  on public.tasks (parent_task_id);

-- 2. Tabla time_entries (registro de tiempo) ----------------------------------
create table if not exists public.time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.tasks(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_sec integer,
  note text,
  created_at timestamptz not null default now()
);

-- Indices (incluye el unico parcial que garantiza un solo timer corriendo por
-- persona: ended_at is null).
create index if not exists te_profile_idx on public.time_entries (profile_id, started_at);
create index if not exists te_project_idx on public.time_entries (project_id, started_at);
create unique index if not exists te_one_running on public.time_entries (profile_id) where (ended_at is null);

-- RLS: el dueno ve/gestiona lo suyo; el manager del proyecto tambien puede leer.
alter table public.time_entries enable row level security;

drop policy if exists te_select_owner_or_manager on public.time_entries;
create policy te_select_owner_or_manager on public.time_entries
  for select using (
    profile_id = auth.uid()
    or exists (
      select 1 from public.project_members pm
      where pm.project_id = time_entries.project_id
        and pm.profile_id = auth.uid()
        and pm.role = 'manager'
    )
  );

drop policy if exists te_insert_owner on public.time_entries;
create policy te_insert_owner on public.time_entries
  for insert with check (profile_id = auth.uid());

drop policy if exists te_update_owner on public.time_entries;
create policy te_update_owner on public.time_entries
  for update using (profile_id = auth.uid()) with check (profile_id = auth.uid());

drop policy if exists te_delete_owner on public.time_entries;
create policy te_delete_owner on public.time_entries
  for delete using (profile_id = auth.uid());

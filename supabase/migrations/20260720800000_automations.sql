-- Circuito 3.A: motor de automatizaciones (reglas "cuando pase X, haz Y").
-- Tabla aditiva, sin FK que cierre ciclo y sin policy RLS que consulte su
-- propia tabla (landmines conocidas). Toda escritura pasa por el service role
-- tras el gateo en la API; la lectura directa se limita a miembros del
-- workspace via subquery a workspace_members (otra tabla, sin recursion).

create table if not exists public.automations (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  project_id     uuid not null references public.projects(id)   on delete cascade,
  name           text not null default 'Regla',
  trigger        text not null,
  trigger_config jsonb not null default '{}'::jsonb,
  conditions     jsonb not null default '[]'::jsonb,
  actions        jsonb not null default '[]'::jsonb,
  is_active      boolean not null default true,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint automations_trigger_chk
    check (trigger in ('status_changed','assigned','task_created','due'))
);

create index if not exists automations_project_idx
  on public.automations (project_id, is_active);

alter table public.automations enable row level security;

drop policy if exists automations_select_member on public.automations;
create policy automations_select_member on public.automations
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = automations.workspace_id
        and wm.profile_id = auth.uid()
    )
  );

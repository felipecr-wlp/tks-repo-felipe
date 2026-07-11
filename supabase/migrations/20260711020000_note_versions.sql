-- Circuito A4: Historial de versiones de notas (snapshots del contenido).
-- Cada guardado de contenido crea o coalesce una version. Permite ver el
-- historial y restaurar una version anterior (tipo Notion/Google Docs).

create table if not exists public.note_versions (
  id           uuid primary key default gen_random_uuid(),
  note_id      uuid not null references public.notes(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title        text not null default 'Sin titulo',
  content      text,
  edited_by    uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists note_versions_note_idx on public.note_versions(note_id, created_at desc);
create index if not exists note_versions_workspace_idx on public.note_versions(workspace_id);

alter table public.note_versions enable row level security;

-- Lectura: cualquier miembro del workspace de la version.
drop policy if exists note_versions_select on public.note_versions;
create policy note_versions_select on public.note_versions
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = note_versions.workspace_id
        and wm.profile_id = auth.uid()
    )
  );

-- La escritura (snapshot / coalesce / restore) la hace el service_role desde
-- el API, por eso no exponemos policies de insert/update/delete a usuarios.

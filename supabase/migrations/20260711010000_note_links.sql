-- Circuito A3: Backlinks entre notas (grafo de documentacion tipo Notion/Obsidian).
-- Tabla de aristas dirigidas: la nota "source" enlaza a la nota "target".
-- Se recalcula en cada guardado del contenido (borrar + reinsertar por source).

create table if not exists public.note_links (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  source_note_id uuid not null references public.notes(id) on delete cascade,
  target_note_id uuid not null references public.notes(id) on delete cascade,
  created_at     timestamptz not null default now(),
  unique (source_note_id, target_note_id)
);

-- Una nota no se enlaza a si misma.
alter table public.note_links
  add constraint note_links_no_self check (source_note_id <> target_note_id);

create index if not exists note_links_target_idx on public.note_links(target_note_id);
create index if not exists note_links_source_idx on public.note_links(source_note_id);
create index if not exists note_links_workspace_idx on public.note_links(workspace_id);

alter table public.note_links enable row level security;

-- Lectura: cualquier miembro del workspace de la arista.
drop policy if exists note_links_select on public.note_links;
create policy note_links_select on public.note_links
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = note_links.workspace_id
        and wm.profile_id = auth.uid()
    )
  );

-- La escritura la hace el service_role desde el API (recompute-on-save),
-- por eso no exponemos policies de insert/delete a usuarios normales.

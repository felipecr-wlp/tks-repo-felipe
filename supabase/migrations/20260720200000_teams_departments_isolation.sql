-- Jerarquia Workspace -> Departamento (space) -> Equipo (team) -> Miembros, con
-- aislamiento duro para que un equipo dentro de un departamento restringido solo
-- lo vean sus miembros (y los administradores del workspace/organizacion).
--
-- Seguridad y anti-landmines:
--  (1) teams.space_id es NULLABLE. Los equipos legacy (workspace General) quedan
--      con space_id NULL = visibles a todo el workspace, comportamiento sin cambios.
--  (2) FK COMPUESTA (space_id, workspace_id) -> spaces (id, workspace_id): fija que
--      el departamento del equipo viva en el MISMO workspace. teams -> spaces ->
--      workspaces es un ARBOL (sin ciclo), asi que NO dispara el HTTP 300 de PostgREST.
--  (3) can_see_team es SECURITY DEFINER STABLE: por dentro salta RLS, evitando la
--      recursion 42P17 de una policy que consulta su propia tabla.
--  (4) Se preserva el bypass de administrador de organizacion (org_role owner/admin).

-- Clave unica necesaria para poder referenciar (id, workspace_id) desde la FK compuesta.
create unique index if not exists spaces_id_workspace_uidx
  on public.spaces (id, workspace_id);

-- Departamento del equipo (nullable = equipo suelto a nivel workspace).
alter table public.teams
  add column if not exists space_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'teams_space_workspace_fkey'
  ) then
    alter table public.teams
      add constraint teams_space_workspace_fkey
      foreign key (space_id, workspace_id)
      references public.spaces (id, workspace_id)
      on delete set null;
  end if;
end $$;

create index if not exists teams_space_id_idx on public.teams (space_id);

-- Helpers SECURITY DEFINER (saltan RLS por dentro, sin recursion).
create or replace function public.is_team_member(p_team uuid)
  returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where team_id = p_team and profile_id = auth.uid()
  );
$$;

create or replace function public.is_team_admin(p_team uuid)
  returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from team_members
    where team_id = p_team and profile_id = auth.uid() and role = 'admin'
  );
$$;

-- Visibilidad de un equipo para el usuario actual:
--  - debe pertenecer a un workspace del usuario, Y
--  - el equipo no tiene departamento (NULL), o el departamento no es restringido,
--    o el usuario es miembro de ese departamento.
create or replace function public.can_see_team(p_team uuid)
  returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from teams t
    left join spaces s on s.id = t.space_id
    where t.id = p_team
      and t.workspace_id in (
        select workspace_id from workspace_members where profile_id = auth.uid()
      )
      and (
        t.space_id is null
        or s.is_restricted = false
        or exists (
          select 1 from space_members sm
          where sm.space_id = t.space_id and sm.profile_id = auth.uid()
        )
      )
  );
$$;

grant execute on function public.is_team_member(uuid) to authenticated;
grant execute on function public.is_team_admin(uuid) to authenticated;
grant execute on function public.can_see_team(uuid) to authenticated;

-- Reescritura de las policies de lectura para respetar el aislamiento por depto.
-- (INSERT/DELETE/UPDATE se dejan intactas: ya funcionan y no cambian el modelo.)
drop policy if exists teams_select on public.teams;
create policy teams_select on public.teams for select using (
  ((select org_role from profiles where id = auth.uid()) = any (array['owner','admin']))
  or can_see_team(id)
);

drop policy if exists team_members_select on public.team_members;
create policy team_members_select on public.team_members for select using (
  profile_id = auth.uid()
  or ((select org_role from profiles where id = auth.uid()) = any (array['owner','admin']))
  or can_see_team(team_id)
);

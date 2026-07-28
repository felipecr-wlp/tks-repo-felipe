-- Multi-dominio para auto-adhesion por correo (sala de espera / lobby).
--
-- Contexto: organizations.email_domain es un solo dominio por org (indice unico).
-- Para admitir varios dominios de una misma empresa (ej. pavific.com,
-- welovepaving.com, welovepaving.net) sin romper ese modelo, esta tabla agrega
-- dominios ALIAS que mapean a una organizacion. El email_domain de organizations
-- sigue siendo el primario; aqui viven los adicionales (y una copia del primario
-- por backfill, para que auto-join consulte un solo lugar).
--
-- Seguridad por landmines TSKR:
--  - FK de una sola via a organizations (organizations NO referencia a esta
--    tabla): sin ciclo -> sin HTTP 300 en embeds de PostgREST.
--  - RLS habilitado SIN policies: solo el service_role (admin client de la app,
--    que bypassa RLS) lee/escribe. anon/authenticated no ven filas. Sin subquery
--    a la propia tabla -> sin recursion 42P17.

create table if not exists public.org_email_domains (
  org_id     uuid        not null references public.organizations(id) on delete cascade,
  domain     text        not null,
  created_at timestamptz not null default now(),
  primary key (org_id, domain)
);

-- Un dominio mapea a lo sumo a UNA org.
create unique index if not exists org_email_domains_domain_key
  on public.org_email_domains (domain);

alter table public.org_email_domains enable row level security;

comment on table public.org_email_domains is
  'Dominios de correo (incl. alias) que mapean a una organizacion para auto-adhesion. El email_domain de organizations es el primario; esta tabla agrega los adicionales. Solo service_role.';

-- Backfill: el dominio primario de cada org tambien vive aqui (idempotente).
insert into public.org_email_domains (org_id, domain)
select id, lower(email_domain)
from public.organizations
where email_domain is not null and length(trim(email_domain)) > 0
on conflict (domain) do nothing;

-- Alias solicitados: welovepaving.com y welovepaving.net -> org activa Pavific
-- (06618d0f, default_workspace daf8b859). pavific.com ya entro por backfill.
insert into public.org_email_domains (org_id, domain) values
  ('06618d0f-a6a6-49d2-b77f-56543896552b', 'welovepaving.com'),
  ('06618d0f-a6a6-49d2-b77f-56543896552b', 'welovepaving.net')
on conflict (domain) do nothing;

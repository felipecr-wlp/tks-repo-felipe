-- Registro de conectores: el nucleo de WLO como plataforma de complementos.
--
-- Idea: WLO es el hub. Aqui viven (a) el catalogo de apps del ecosistema, (b) los
-- complementos instalados con su manifiesto, (c) las keys que autorizan a una app
-- a llamar a otra con scopes acotados, (d) las suscripciones a webhooks, y (e) la
-- bitacora de toda llamada entre apps.
--
-- Reglas duras respetadas (landmines conocidas de este repo):
--   - Tablas aditivas, sin FK que cierre ciclo entre tablas ya relacionadas.
--   - Ninguna policy RLS consulta su PROPIA tabla (evita 42P17). El gateo real de
--     escritura vive en la API con el service role; la lectura directa se limita a
--     miembros del workspace via subquery a workspace_members (otra tabla).
--   - Nada de guion largo en comentarios.
--
-- Seguridad: en connector_keys se guarda SOLO el hash del token (sha256), nunca el
-- texto plano. El texto se muestra una sola vez al crearlo, en la respuesta de la API.

-- ── Catalogo de apps del ecosistema (global, no por workspace) ────────────────
create table if not exists public.connector_apps (
  id          text primary key,               -- 'wli', 'wlo', 'wlm'
  name        text not null,
  base_url    text not null,
  icon        text,
  created_at  timestamptz not null default now()
);

-- Semilla de las tres apps vivas. base_url editable luego desde el panel.
insert into public.connector_apps (id, name, base_url, icon) values
  ('wli', 'WLI Marketing OS', 'https://wli-marketing-os.vercel.app', 'mail'),
  ('wlo', 'WLO Workspace',    'https://wlo.vercel.app',              'layout-grid'),
  ('wlm', 'WLM Measure',      'https://wlm-nu.vercel.app',           'ruler')
on conflict (id) do nothing;

-- ── Complementos instalados (manifiesto + estado) ─────────────────────────────
create table if not exists public.connector_installs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  app_id        text not null references public.connector_apps(id),
  manifest      jsonb not null default '{}'::jsonb,   -- nombre, nodos, scopes requeridos
  enabled       boolean not null default true,
  installed_by  uuid references public.profiles(id) on delete set null,
  installed_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists connector_installs_ws_idx
  on public.connector_installs (workspace_id, enabled);

-- ── Keys (tokens) por integracion. Se guarda solo el hash ─────────────────────
create table if not exists public.connector_keys (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  name          text not null,                        -- 'WLO -> WLI (emailer)'
  target_app    text not null references public.connector_apps(id),
  token_hash    text not null unique,                 -- sha256 hex del pck_live_...
  token_prefix  text not null,                        -- 'pck_live_ab12' para mostrar
  scopes        text[] not null default '{}',         -- scopes autorizados
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz                           -- si no es null, la key esta muerta
);
create index if not exists connector_keys_ws_idx
  on public.connector_keys (workspace_id);
-- Lookup del provider: por hash, solo vivas.
create index if not exists connector_keys_hash_idx
  on public.connector_keys (token_hash) where revoked_at is null;

-- ── Suscripciones a webhooks (triggers) ───────────────────────────────────────
create table if not exists public.connector_webhooks (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  source_app    text not null references public.connector_apps(id),  -- quien emite
  event         text not null,                        -- 'lead.created'
  target_url    text not null,                        -- a donde se hace POST
  secret        text not null,                        -- para el HMAC
  enabled       boolean not null default true,
  created_by    uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists connector_webhooks_ws_idx
  on public.connector_webhooks (workspace_id, enabled);

-- ── Bitacora: TODA llamada entre apps queda aqui ──────────────────────────────
create table if not exists public.connector_call_log (
  id           bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces(id) on delete set null,
  caller_app   text,
  target_app   text,
  action       text,
  scope        text,
  status       int,                                   -- 200, 401, 403, 500
  key_id       uuid references public.connector_keys(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index if not exists connector_call_log_ws_idx
  on public.connector_call_log (workspace_id, created_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Lectura directa: miembros del workspace. Escritura: solo service role (API), que
-- ademas gatea a admin/owner en el handler. connector_apps es catalogo publico de
-- lectura (no lleva secretos), pero NO la escribe nadie por RLS.

alter table public.connector_apps      enable row level security;
alter table public.connector_installs  enable row level security;
alter table public.connector_keys      enable row level security;
alter table public.connector_webhooks  enable row level security;
alter table public.connector_call_log  enable row level security;

drop policy if exists connector_apps_select_all on public.connector_apps;
create policy connector_apps_select_all on public.connector_apps
  for select using (true);

drop policy if exists connector_installs_select_member on public.connector_installs;
create policy connector_installs_select_member on public.connector_installs
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = connector_installs.workspace_id
        and wm.profile_id = auth.uid()
    )
  );

drop policy if exists connector_webhooks_select_member on public.connector_webhooks;
create policy connector_webhooks_select_member on public.connector_webhooks
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = connector_webhooks.workspace_id
        and wm.profile_id = auth.uid()
    )
  );

drop policy if exists connector_call_log_select_member on public.connector_call_log;
create policy connector_call_log_select_member on public.connector_call_log
  for select using (
    exists (
      select 1 from public.workspace_members wm
      where wm.workspace_id = connector_call_log.workspace_id
        and wm.profile_id = auth.uid()
    )
  );

-- connector_keys NO tiene policy de select para clientes: los tokens (aunque
-- hasheados) y scopes se leen SOLO por el service role en la API. Sin policy de
-- select, ningun cliente con anon key ve esta tabla.

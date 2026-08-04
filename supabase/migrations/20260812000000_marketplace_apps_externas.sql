-- Marketplace de herramientas EXTERNAS: cada quien publica la suya sin subir
-- codigo a WLO.
--
-- Por que asi y no subiendo archivos. El intento anterior fue "sube un ZIP y WLO
-- lo sirve": eso no puede funcionar en Vercel (el disco es de solo lectura fuera
-- de /tmp, por diseno, no por bug) y ademas obliga a WLO a EJECUTAR codigo ajeno
-- dentro de su propio proceso, que es la peor clase de riesgo que existe. Aqui la
-- herramienta vive en SU propio deploy, con SU propio repo y SU propio lenguaje.
-- WLO solo guarda a donde apunta, que permisos pidio y quien se los concedio.
-- La pregunta "que lenguajes soportamos?" desaparece: los que soporte Vercel,
-- porque el build ya no es problema de WLO.
--
-- Dos piezas nuevas:
--   1. connector_apps deja de ser la lista fija de las tres apps de casa y pasa a
--      ser un catalogo con dueno, estado de revision y scopes SOLICITADOS.
--   2. connector_installs guarda lo CONCEDIDO por workspace, mas un token propio
--      de esa instalacion.
--
-- El detalle que hace que esto sea un permiso de verdad: lo que la app PIDE
-- (`requested_scopes`) y lo que el workspace le CONCEDE (`granted_scopes`) son
-- columnas distintas. Si fueran la misma, publicar una version nueva que pide mas
-- se concederia sola y nadie se enteraria. Separadas, pedir mas no cambia nada
-- hasta que un admin lo acepte en pantalla.
--
-- Landmines respetadas: todo es aditivo, ninguna FK cierra ciclo, ninguna policy
-- consulta su propia tabla.

-- ── 1. Catalogo de apps ───────────────────────────────────────────────────────
alter table public.connector_apps
  add column if not exists description       text,
  add column if not exists owner_profile_id  uuid references public.profiles(id) on delete set null,
  add column if not exists status            text not null default 'draft',
  add column if not exists kind              text not null default 'connector',
  add column if not exists embed_path        text,
  add column if not exists requested_scopes  text[] not null default '{}',
  add column if not exists updated_at        timestamptz not null default now();

-- status: draft = la propuso alguien y nadie la reviso; approved = se puede
-- instalar; retired = ya no se ofrece (las instalaciones vivas no se tocan, para
-- no apagarle la herramienta a nadie de golpe).
alter table public.connector_apps drop constraint if exists connector_apps_status_check;
alter table public.connector_apps add constraint connector_apps_status_check
  check (status in ('draft', 'approved', 'retired'));

-- kind: connector = habla por API y no se ve; embed = ademas se pinta dentro de
-- WLO en un iframe. Lo segundo exige que su origen este en la allowlist del CSP,
-- que vive en el codigo (src/lib/connectors/embed-origins.json), no aqui: el
-- navegador solo obedece la cabecera, asi que una fila de base de datos NUNCA
-- puede autorizar un embed por si sola.
alter table public.connector_apps drop constraint if exists connector_apps_kind_check;
alter table public.connector_apps add constraint connector_apps_kind_check
  check (kind in ('connector', 'embed'));

-- Las tres apps de casa ya estaban vivas antes de que existiera el estado, asi
-- que nacen aprobadas. Sin esto el catalogo las esconderia y se romperia lo que
-- ya funciona.
update public.connector_apps
   set status = 'approved'
 where id in ('wli', 'wlo', 'wlm') and status = 'draft';

create index if not exists connector_apps_status_idx
  on public.connector_apps (status);

-- ── 2. Lo concedido por workspace ─────────────────────────────────────────────
alter table public.connector_installs
  add column if not exists granted_scopes    text[] not null default '{}',
  add column if not exists token_hash        text,
  add column if not exists token_prefix      text,
  add column if not exists token_expires_at  timestamptz;

-- El token es de la INSTALACION, no de la persona que instalo. Si fuera de la
-- persona, el dia que se va de la empresa la herramienta se cae sin que nadie
-- entienda por que, y mientras tanto actua con sus permisos personales. Siendo de
-- la instalacion, actua con los scopes que el workspace acepto y se muere cuando
-- se desinstala.
create unique index if not exists connector_installs_token_hash_uk
  on public.connector_installs (token_hash) where token_hash is not null;

-- Una app instalada dos veces en el mismo workspace deja dos tokens vivos y solo
-- uno visible en pantalla: el otro queda flotando con permisos y sin dueno.
create unique index if not exists connector_installs_ws_app_uk
  on public.connector_installs (workspace_id, app_id);

comment on column public.connector_apps.requested_scopes is
  'Lo que la app PIDE. Cambiarlo no concede nada por si solo.';
comment on column public.connector_installs.granted_scopes is
  'Lo que este workspace CONCEDIO. Es el techo real de la app aqui.';

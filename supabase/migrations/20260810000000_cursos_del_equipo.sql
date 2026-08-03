-- Cursos hechos por el equipo, con autorizacion antes de publicar.
--
-- POR QUE. La Academia era contenido-como-codigo: los 12 cursos viven en
-- src/lib/academy/courses.ts y para publicar uno hay que abrir el repo y hacer
-- deploy. Eso deja fuera a todo el que sabe algo y no programa, que es casi
-- todo el mundo. Academia resulto ser ademas la unica herramienta que la gente
-- busco sola (cinco solicitudes de cinco personas distintas en tres dias), asi
-- que es el peor lugar posible para tener un cuello de botella tecnico.
--
-- EL RIESGO REAL Y COMO SE CIERRA. El resto de la Academia (academy_access,
-- academy_progress, academy_certificates) guarda el course_id como TEXTO
-- PELADO, sin llave foranea a ningun catalogo. Si un curso del equipo pudiera
-- llamarse 'seo', su progreso y sus certificados se mezclarian con los del
-- curso oficial 'seo' y nadie lo notaria hasta que alguien presuma un
-- certificado que no gano. No se resuelve pidiendo cuidado: se resuelve
-- haciendolo IMPOSIBLE. Todo curso del equipo vive obligatoriamente bajo el
-- prefijo 'eq-' (CHECK abajo) y ningun curso oficial empieza con 'eq-'
-- (verificado, y hay un tripwire que lo vigila). Los dos espacios de nombres
-- no se pueden tocar.
--
-- OJO CON LOS EMBEDS. Esta tabla tiene DOS llaves foraneas a profiles
-- (author_id y reviewed_by). PostgREST no puede adivinar cual usar y responde
-- HTTP 300 a cualquier embed ambiguo, que en esta casa ya rompio todo una vez.
-- Al hacer select con profiles hay que nombrar la constraint explicitamente:
--   profile:profiles!academy_custom_courses_author_id_fkey ( ... )

create table if not exists academy_custom_courses (
  id uuid primary key default gen_random_uuid(),

  -- El course_id que usara el resto de la Academia. Prefijo obligatorio.
  course_id text not null unique,

  -- Nullable a proposito: si la persona se va, su curso publicado NO se borra.
  -- Un curso aprobado es del equipo, no de quien lo escribio.
  author_id uuid references profiles(id) on delete set null,

  status text not null default 'draft',

  title text not null,
  subtitle text not null default '',
  track text not null default 'Equipo',
  icon text not null default 'book-open',
  accent text not null default '#6366F1',
  lang text not null default 'es',
  cert_name text not null default '',

  -- El contenido: array de modulos con la misma forma que courses.ts
  -- (id, num, icon, dur, title, tag, objectives, lessons, quiz).
  modules jsonb not null default '[]'::jsonb,

  submitted_at timestamptz,
  reviewed_by uuid references profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  published_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- La barrera que hace imposible la colision con un curso oficial.
  constraint academy_custom_courses_prefijo_eq
    check (course_id ~ '^eq-[a-z0-9][a-z0-9-]{1,38}$'),

  constraint academy_custom_courses_status_valido
    check (status in ('draft', 'pending_review', 'published', 'rejected', 'archived')),

  constraint academy_custom_courses_lang_valido
    check (lang in ('es', 'en')),

  -- El contenido tiene que ser una lista de modulos, no un objeto suelto.
  constraint academy_custom_courses_modules_es_lista
    check (jsonb_typeof(modules) = 'array'),

  -- Un curso publicado sin modulos es una promesa vacia en la biblioteca:
  -- alguien pide acceso, espera, entra y no hay nada. Se prohibe en la BD
  -- porque la BD es el unico lugar por donde pasan TODAS las escrituras.
  constraint academy_custom_courses_publicado_no_vacio
    check (status <> 'published' or jsonb_array_length(modules) > 0)
);

-- La biblioteca lee los publicados en cada carga; la cola de revision lee los
-- pendientes. Son las dos consultas calientes.
create index if not exists academy_custom_courses_status_idx
  on academy_custom_courses (status);

-- "mis cursos" en el editor.
create index if not exists academy_custom_courses_author_idx
  on academy_custom_courses (author_id);

alter table academy_custom_courses enable row level security;

-- Las rutas /api usan el service role y se saltan RLS: estas policies son
-- defensa en profundidad, no la barrera principal. La barrera principal es el
-- if explicito en cada handler.
drop policy if exists academy_custom_courses_lectura on academy_custom_courses;
create policy academy_custom_courses_lectura on academy_custom_courses
  for select
  using (
    -- Publicado lo ve cualquiera que este dentro.
    status = 'published'
    -- Su propio borrador lo ve su autor, aunque no este publicado.
    or author_id = auth.uid()
    -- Y los mandos ven todo, porque son quienes autorizan.
    or exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.org_role in ('owner', 'admin')
    )
  );

-- Escribir pasa siempre por /api (service role), que valida transiciones de
-- estado. No se abre escritura directa desde el navegador.
drop policy if exists academy_custom_courses_escritura on academy_custom_courses;
create policy academy_custom_courses_escritura on academy_custom_courses
  for all
  using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.org_role in ('owner', 'admin')
    )
  )
  with check (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.org_role in ('owner', 'admin')
    )
  );

comment on table academy_custom_courses is
  'Cursos escritos por el equipo. Se publican solo tras aprobacion de un admin/owner. El course_id lleva prefijo eq- obligatorio para no poder colisionar con los cursos oficiales de courses.ts.';

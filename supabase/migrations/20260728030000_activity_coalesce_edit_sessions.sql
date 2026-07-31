-- Bitacora legible: una SESION de edicion, no un renglon por autoguardado.
--
-- Problema real medido en produccion (2026-07-28): de 2,922 eventos totales,
-- 2,410 eran 'whiteboard.updated', o sea el 82% de la bitacora. La pizarra
-- guarda sola cada pocos segundos y cada guardado se registraba como una accion
-- del usuario. Resultado: unos 345 renglones por pizarra y la actividad de
-- verdad (tareas, proyectos, notas) sepultada.
--
-- Se arregla en dos tiempos:
--   1. Hacia adelante, la app COALESCE: si la misma persona sigue editando el
--      mismo objeto dentro de la ventana, se actualiza el evento que ya existe
--      en vez de insertar otro (ver `logActivityCoalesced` en src/lib/activity.ts).
--   2. Hacia atras, esta migracion MARCA los renglones redundantes que ya
--      estaban escritos. No se borra nada: un audit log no se trunca. Se marcan
--      y los lectores del feed los omiten.
--
-- Ojo con los landmines conocidos: aqui NO hay FK nueva (nada de ciclos que
-- provoquen HTTP 300 en PostgREST) ni policy con subquery a su propia tabla
-- (nada de 42P17). Es una columna, un indice parcial y un UPDATE de datos.

-- ── 1. La marca ──────────────────────────────────────────────────────────────
alter table public.activity_events
  add column if not exists is_superseded boolean not null default false;

comment on column public.activity_events.is_superseded is
  'true = este evento fue absorbido por otro posterior de la misma sesion de edicion (mismo autor, mismo objeto, misma ventana). La fila se conserva para auditoria pero NO se muestra en el feed.';

-- Indice parcial: el feed siempre pide workspace + no superado + mas reciente
-- primero. Al ser parcial solo indexa lo que de verdad se lee.
create index if not exists activity_events_feed_idx
  on public.activity_events (workspace_id, created_at desc)
  where is_superseded = false;

-- ── 2. Limpieza del historial ya escrito ─────────────────────────────────────
-- Se agrupa por (workspace, autor, objeto, verbo) y por ventana de 30 minutos.
-- De cada grupo sobrevive el evento MAS RECIENTE, que es el que representa la
-- sesion completa; el resto queda marcado. Solo aplica a los verbos de edicion
-- continua: crear, borrar, asignar y demas son eventos puntuales y cada uno
-- merece su renglon.
with sesiones as (
  select
    id,
    row_number() over (
      partition by
        workspace_id,
        subject_id,
        object_type,
        object_id,
        verb,
        floor(extract(epoch from created_at) / 1800)
      order by created_at desc
    ) as rn
  from public.activity_events
  where verb in ('whiteboard.updated', 'note.updated', 'task.updated')
)
update public.activity_events e
set is_superseded = true
from sesiones s
where e.id = s.id
  and s.rn > 1
  and e.is_superseded = false;

-- ── 3. Contador de ediciones en el evento que sobrevive ──────────────────────
-- El feed dice "actualizo la pizarra X · 27 ediciones" en vez de 27 renglones.
-- Se calcula el tamaño de cada grupo y se guarda en el metadata del superviviente.
with grupos as (
  select
    workspace_id, subject_id, object_type, object_id, verb,
    floor(extract(epoch from created_at) / 1800) as bucket,
    count(*) as total,
    max(created_at) as ultimo
  from public.activity_events
  where verb in ('whiteboard.updated', 'note.updated', 'task.updated')
  group by 1, 2, 3, 4, 5, 6
  having count(*) > 1
)
update public.activity_events e
set metadata = coalesce(e.metadata, '{}'::jsonb) || jsonb_build_object('edits', g.total)
from grupos g
where e.is_superseded = false
  and e.workspace_id = g.workspace_id
  and e.subject_id   = g.subject_id
  and e.object_type  = g.object_type
  and e.object_id    = g.object_id
  and e.verb         = g.verb
  and e.created_at   = g.ultimo;

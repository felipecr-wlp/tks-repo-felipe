-- Portada elegible de una nota.
--
-- Hasta hoy la portada salia sola del id de la nota (ver src/lib/note-cover.ts):
-- nunca hay un documento en blanco y nadie tiene que decidir nada. Esta columna
-- solo agrega la posibilidad de SOBRESCRIBIR ese automatico con una clave de la
-- paleta cerrada ('arena', 'indigo', 'menta', ...).
--
-- Se guarda la CLAVE, no el CSS: si manana se ajusta un degradado, todas las
-- notas que usan esa clave se actualizan solas y no queda color muerto en la
-- base. Null = automatico, que es el default y el caso mas comun.
--
-- Sin FK nueva (nada de ciclos que provoquen HTTP 300 en PostgREST) y sin
-- policy nueva: la nota ya esta gobernada por las policies de `notes`.

alter table public.notes
  add column if not exists cover text;

comment on column public.notes.cover is
  'Clave de la paleta de portadas (COVER_PRESETS en src/lib/note-cover.ts). Null = portada automatica derivada del id de la nota.';

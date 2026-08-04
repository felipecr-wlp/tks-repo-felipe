-- El reporte diario nunca guardo NI UNA fila, y nadie se entero.
--
-- Habia dos indices unicos PARCIALES: uno con `where profile_id is null` (el
-- digest del equipo) y otro con `where profile_id is not null` (el de una
-- persona). Postgres solo puede inferir un indice parcial en un ON CONFLICT si
-- le pasas TAMBIEN su predicado WHERE, y PostgREST no tiene forma de expresarlo:
-- su parametro `on_conflict` es una lista de columnas y nada mas. Resultado:
-- 42P10 en las dos ramas, el 100% de las veces, desde siempre.
--
-- El sintoma era el peor posible: la ruta redacta el reporte, falla al guardarlo,
-- lo devuelve igual y solo deja un console.error. La persona ve su reporte y
-- asume que quedo guardado. Por eso la tabla estaba en cero.
--
-- Se reemplazan por UN solo indice total con NULLS NOT DISTINCT (Postgres 15+,
-- aqui 17.6), que trata los nulos como iguales. Asi la misma lista de cuatro
-- columnas sirve para los dos casos y el ON CONFLICT si la puede inferir:
--   - profile_id nulo  -> un digest de equipo por (workspace, periodo, inicio)
--   - profile_id lleno -> un digest por persona y periodo
-- Es exactamente la misma regla de unicidad que habia, expresada de una forma
-- que el cliente si puede nombrar.
drop index if exists public.idx_daily_report_digests_equipo;
drop index if exists public.idx_daily_report_digests_persona;

create unique index if not exists idx_daily_report_digests_unico
  on public.daily_report_digests (workspace_id, profile_id, period, period_start)
  nulls not distinct;

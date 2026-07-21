-- Snooze de notificaciones: posponer una notificacion hasta una fecha/hora.
-- Columna aditiva, nullable, sin FK ni cambios de RLS (segura, reversible).
--
-- Semantica: si snoozed_until IS NOT NULL y > now(), la notificacion se OCULTA
-- de la bandeja; cuando now() la rebasa, reaparece sola (filtro perezoso, sin
-- cron). Al posponer se marca is_read = true para que no cuente como pendiente
-- mientras esta dormida; al reaparecer sigue leida (el usuario decide de nuevo).

alter table public.notifications
  add column if not exists snoozed_until timestamptz;

-- Indice parcial para el filtro de la bandeja (solo filas dormidas).
create index if not exists notifications_snoozed_until_idx
  on public.notifications (recipient_id, snoozed_until)
  where snoozed_until is not null;

comment on column public.notifications.snoozed_until is
  'Si esta en el futuro, la notificacion se oculta de la bandeja hasta esa hora.';

-- Circuito 1.C, recordatorios desde el chat.
--
-- Tabla aditiva `reminders`: desde un mensaje del chat (o suelto) una persona se
-- crea un recordatorio para si misma o para otro miembro del equipo, con fecha y
-- hora. El cron `due-reminders` lo entrega al inbox (y opcionalmente por correo)
-- cuando `remind_at` ya paso.
--
-- Landmine-safe:
--  * Todos los FK apuntan hacia afuera (profiles, workspaces, teams, messages);
--    ninguna de esas tablas apunta de vuelta a reminders => sin ciclo FK (evita
--    el HTTP 300 de PostgREST en embeds).
--  * RLS habilitada con un SELECT simple por dueno/destinatario, SIN subquery a
--    la propia tabla (evita la recursion 42P17). Las escrituras van SOLO por el
--    service/admin client (no hay policy de insert/update/delete), igual que el
--    resto de la app.
--  * message_id es ON DELETE SET NULL: borrar un mensaje no borra el recordatorio.

create table if not exists public.reminders (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  team_id      uuid references public.teams(id)      on delete cascade,
  creator_id   uuid not null references public.profiles(id) on delete cascade,
  target_id    uuid not null references public.profiles(id) on delete cascade,
  message_id   uuid references public.messages(id) on delete set null,
  body         text not null default '',
  remind_at    timestamptz not null,
  status       text not null default 'pending',
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),
  constraint reminders_status_chk check (status in ('pending','sent','canceled'))
);

-- El cron barre por (status,'pending') y remind_at <= now(); este indice lo cubre.
create index if not exists reminders_due_idx on public.reminders (status, remind_at);
-- Consultas por destinatario (por si se lista "mis recordatorios" mas adelante).
create index if not exists reminders_target_idx on public.reminders (target_id, status);

alter table public.reminders enable row level security;

-- Solo el creador o el destinatario pueden VER un recordatorio. Sin subquery a la
-- propia tabla: compara columnas directas contra auth.uid().
drop policy if exists reminders_select_own on public.reminders;
create policy reminders_select_own on public.reminders
  for select using (creator_id = auth.uid() or target_id = auth.uid());

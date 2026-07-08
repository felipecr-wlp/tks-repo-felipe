# CONV A — Shell + Navegación + Google Calendar

Trabajas sobre `C:\Users\GRIZZLY\Desktop\TSKR` (Next.js 14 App Router + Supabase).
Lee primero `docs/coordination/00-AUDITORIA-Y-PLAN.md`. **NO despliegas**: al final
avisas al deployer. Reglas duras: sin guiones largos, sin emojis (iconos lucide),
ñ/tildes correctas, aditivo, seguridad en cada API.

## Tu objetivo
Que el menú y la barra lateral sean **intuitivos y organizados**, un **home** claro,
y **Google Calendar** bien vinculado (agenda "Mi día" + página de calendario).

## Archivos que POSEES (nadie más los toca)
- `src/components/sidebar/**` (Sidebar.tsx, NavSection.tsx, UserMenu.tsx, WorkspaceSwitcher.tsx)
- `src/app/(app)/w/[workspaceSlug]/layout.tsx`
- `src/app/(app)/w/[workspaceSlug]/page.tsx` (home)
- **NUEVO** `src/app/(app)/w/[workspaceSlug]/calendar/**`
- **NUEVO** `src/app/api/calendar/**` y `src/app/api/google/connect|callback/**`
- `src/app/api/auth/callback/route.ts` (extensión de scope; es tuyo)

## Archivos PROHIBIDOS (de otros)
`TaskDetailPanel`, `chat/**`, `projects/[projectId]/**`, `tracking/**`, `my-tasks/**`,
`cv/**`, `src/lib/activity.ts`, `src/lib/supabase/types.ts`.

## Trabajo 1 — Sidebar jerarquizado
Rediseña `Sidebar.tsx` agrupando el nav plano actual en secciones con encabezados
tenues (patrón Linear/Height). Sugerido:
- **Principal**: Inicio, Mis tareas, Bandeja, Calendario (nuevo).
- **Espacio**: Notas, Pizarras, Proyectos abiertos, Mi CV.
- **Equipos**: (lo actual con `NavSection`, colapsable por equipo).
Agrega grupos colapsables con estado en `localStorage` (`wlo-sidebar-groups`).
Mantén el modo colapsado (`w-14`) y los tooltips. Iconos lucide (ya hay SVGs inline;
puedes migrarlos a `lucide-react` para consistencia: Home, CheckSquare, Inbox,
Calendar, FileText, PenTool, Compass, IdCard). Agrega link **Calendario** →
`${base}/calendar` y **Tracking** → `${base}/tracking` (la página Tracking la construye
Conv C; el link queda listo porque el deploy es único al final).

## Trabajo 2 — Home más claro (`page.tsx`)
Reorganiza en tarjetas con jerarquía: saludo + fecha; fila de accesos rápidos
(Mis tareas, Calendario, Proyectos, Notas); **"Mi día"** (agenda de hoy desde Google
Calendar si el user está conectado, si no, un CTA "Conectar Google Calendar"); Equipos;
Actividad reciente. Reusa datos que ya carga el server component. No dupliques la
lógica de `my-tasks` (esa página es de Conv C).

## Trabajo 3 — Google Calendar
1. **Scope incremental**: en el flujo OAuth agrega
   `https://www.googleapis.com/auth/calendar.readonly` (o `calendar.events` si quieres
   crear eventos). Guarda tokens en `google_connections` (ya existe: access_token,
   refresh_token, token_expiry, scopes[]). **Nunca** mandes tokens al cliente.
2. **`GET /api/calendar/events?from=&to=`**: server-side, refresca token si expiró
   (`google.auth.OAuth2` de `googleapis`, ya instalado), llama `calendar.events.list`,
   devuelve eventos normalizados `{ id, title, start, end, allDay, htmlLink }`.
   Auth + solo el propio `google_connection` (RLS ya limita a `profile_id = auth.uid()`).
3. **Página `/w/[slug]/calendar`**: vista mensual/semanal. Puedes usar
   `react-big-calendar` (ya está en package.json) o construir una grilla propia.
   Estado vacío con botón "Conectar Google Calendar" → `/api/google/connect`.
4. (Opcional) tabla `calendar_events` como cache para no pegarle a Google en cada
   render; si la creas, migración propia vía Supabase MCP `apply_migration`, y usa
   `(admin as any)`.

### Seguridad calendario
- Todo server-side. Refresh token nunca al front. Maneja el caso "no conectado" y
  "token revocado" (409/reconnect), no 500.
- El comentario del schema pide encriptar tokens con Supabase Vault en prod: déjalo
  anotado como hardening pendiente si no lo implementas.

## Cierre
1. Si creaste tabla: aplícala con Supabase MCP `apply_migration` (NO por deploy).
2. `cd "C:\Users\GRIZZLY\Desktop\TSKR" && npx tsc --noEmit` → debe dar `EXIT: 0`.
3. Anota en `docs/COLAB-CHANGELOG.md` una entrada con lo que hiciste.
4. Avisa al deployer: "Conv A listo" + lista de archivos tocados + si aplicaste migración.

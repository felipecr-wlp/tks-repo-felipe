# CONV B — Calendario sin ruido + actividades WLO

Dueño exclusivo de: `src/app/api/calendar/events/route.ts`, `src/app/(app)/w/[workspaceSlug]/calendar/CalendarView.tsx`, `src/app/(app)/w/[workspaceSlug]/MiDia.tsx`, y NUEVO `src/app/api/activities/route.ts`. No tocar otros archivos.

## Contexto
`api/calendar/events` regresa TODO el calendario `primary` (mucho meet recurrente). MiDia y CalendarView solo pintan Google. Las tareas WLO con `due_date` y los sprints no aparecen. El usuario quiere menos ruido de Google y ver más lo de WLO.

## Tareas

### B1 — Nuevo endpoint de actividades WLO: `GET /api/activities?from=&to=`
- Seguridad estándar: `applyRateLimit`, `createClient` auth (401), `createAdminClient`, zod `.strict()` para `from`/`to` (datetime opcional; default: hoy -1d a +60d).
- Devuelve actividades del usuario en el rango, normalizadas:
  - Tareas asignadas (`tasks.assignee_id = user.id`, `is_archived=false`, `due_date` en rango) -> `{ id, type:'task', title, date: due_date, priority, project_name, href }`. Filtrar por proyectos de equipos donde el user es miembro (re-check membership vía `team_members` -> `projects`).
  - Sprints activos/próximos de sus equipos (`sprints.end_date` en rango) -> `{ id, type:'sprint', title, date: end_date, href }`.
- Nunca exponer datos de equipos donde el user no es miembro (anti-IDOR).

### B2 — MiDia: WLO primero, Google atenuado
- Además de Google (hoy), pedir `/api/activities` para HOY y mostrar arriba una lista "Tareas de hoy" (tareas WLO con due hoy + fin de sprint). Google queda debajo como "Agenda externa".
- Distinguir visualmente: actividades WLO con acento primario + icono lucide (`CheckSquare`/`Timer`); Google en tono muted.
- Si no hay conexión Google, MiDia sigue útil mostrando solo actividades WLO (ya no queda vacío/CTA-only).

### B3 — CalendarView: fuentes + filtro de ruido
- Merge de 2 fuentes: eventos Google + actividades WLO (`/api/activities`), diferenciadas por color/badge.
- Filtros cliente minimalistas (toggles): "Actividades WLO", "Eventos Google". Y para bajar ruido de Google: toggle "Ocultar eventos de todo el día" y buscador por título. Persistir toggles en localStorage `wlo-calendar-filters`.
- Default sugerido: WLO ON, Google ON, "todo el día" oculto = OFF (no ocultar por defecto, solo dar el control). Confirmar con dueño C que no colisiona (no colisiona: C no toca calendar).

### B4 — `api/calendar/events`: soporte de filtro server-side opcional (aditivo)
- Aceptar query opcional `q` (búsqueda por summary) y `hideAllDay` (bool) además de `from`/`to`, todo en el zod `.strict()`. Mantener retrocompatibilidad (sin params = comportamiento actual). El filtrado fuerte vive en cliente (B3); esto es refuerzo.

## Fuera de alcance
- No tocar Sidebar, team/project pages, home, ScrumWorkspace.

## Cierre
`npx tsc --noEmit` EXIT:0; revisar imports sin usar y comillas sin escapar en JSX; entrada en `docs/COLAB-CHANGELOG.md` (Conv B R2). No deployar.

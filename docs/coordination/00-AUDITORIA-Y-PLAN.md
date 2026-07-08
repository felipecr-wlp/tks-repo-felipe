# Ronda 2 — Auditoría y Plan Maestro (jerarquía, calendario, tableros)

Fecha: 2026-07-04. Objetivo: app minimalista, funcional, sólida. Resolver 3 dolores reales detectados en código. (Round 1 archivado en `*-R1.md`, ya deployado.)

## Hallazgos de auditoría (verificados en código)

### 1. Jerarquía equipos/proyectos confusa (doble ubicación de "Proyectos")
- Sidebar grupo "Espacio" tiene `Proyectos abiertos` -> `/w/[slug]/projects` = marketplace interno (postulaciones), NO el workspace de trabajo.
- Los proyectos reales de trabajo viven en `/w/[slug]/t/[teamSlug]/p/[projectSlug]`.
- El usuario no distingue "postularme a un proyecto" de "entrar a trabajar en mi proyecto". Falta jerarquía visual Org > Workspace > Equipo > Proyecto.
- Bug: `t/[teamSlug]/page.tsx` línea 151 usa emoji fallback (viola regla no-emoji).

### 2. Calendario con ruido de meets externos
- `api/calendar/events` devuelve TODO el calendario `primary` sin filtro (meets recurrentes repetidos cada día).
- MiDia y CalendarView solo muestran Google. Las actividades propias de WLO (tareas con `due_date`, deadlines de sprint) NO aparecen.
- Falta: filtrar/atenuar ruido de Google + traer actividades WLO al frente.

### 3. Scrum/Kanban escondidos
- Solo se llega expandiendo un equipo en sidebar, o botón "Scrum" en team page.
- El toggle Scrum<->Kanban vive dentro de `ScrumWorkspace` (solo admin). El usuario no percibe que existe el tablero ni los 2 modos.
- No hay acceso al tablero desde Inicio ni desde la vista del proyecto.

## Principios de la ronda
- Aditivo. Cero migraciones destructivas. Si hay migración, aditiva y por Supabase MCP.
- Sin em/en dash. Sin emojis (iconos lucide). Español con ñ/tildes.
- Seguridad estándar: `createClient` auth + `createAdminClient` con re-check de membership, zod `.strict()`, `applyRateLimit`.
- No editar `src/lib/supabase/types.ts` a mano; usar `(admin as any).from(...)` para tablas fuera de types.
- Un dueño por archivo (regla anticolisión). Cierre por conv: `npx tsc --noEmit` EXIT:0 + revisar lint (imports sin usar, comillas sin escapar) + entrada en `docs/COLAB-CHANGELOG.md`. NO deployar (el deployer hace el único deploy final).

## Reparto por dominio (sin solape de archivos)

| Conv | Dominio | Archivos que POSEE |
|------|---------|--------------------|
| A | Navegación jerárquica + surfacing de tableros | `src/components/sidebar/Sidebar.tsx`, `NavSection.tsx`, `WorkspaceSwitcher.tsx` |
| B | Calendario sin ruido + actividades WLO | `src/app/api/calendar/events/route.ts`, `calendar/CalendarView.tsx`, `MiDia.tsx`, NUEVO `src/app/api/activities/route.ts` |
| C | Lógica proyectos/equipos + pulido | `t/[teamSlug]/page.tsx`, `t/[teamSlug]/p/[projectSlug]/page.tsx`, `projects/page.tsx`, `projects/[projectId]/page.tsx`, `w/[workspaceSlug]/page.tsx` (home) |

Prohibido para todos salvo el dueño: `ScrumWorkspace.tsx` y `components/scrum/*` (no se tocan; solo se enlazan). `my-tasks/**`, `tracking/**`, `inbox/**` fuera de alcance.

Ver 01-CONV-A.md, 02-CONV-B.md, 03-CONV-C.md.

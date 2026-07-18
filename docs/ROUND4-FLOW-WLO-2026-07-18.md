# Ronda 4 — Rediseño de flujo estilo Linear (WLO)

Fecha: 2026-07-18
Commit: `fd903e4` "feat: ronda 4, rediseno de flujo estilo Linear (sidebar, inicio, header de proyecto)"
Alcance: 3 archivos, +126 / -191 líneas (el rediseño QUITA más de lo que agrega)

> **ESTADO DE DEPLOY: commit LOCAL únicamente. SIN push a origin y SIN deploy a producción.**
> Este entorno no tiene credenciales de GitHub ni sesión de Vercel CLI (se pierden entre sesiones).
> Ver sección 5 con los pasos manuales exactos.

---

## 1. Directiva y alcance acordado

Directiva del usuario: "ENFOCATE EN MEJORAR EL FRONTEND, NO ME GUSTA EL ACOMODO, ME PARECE CONTRAINTUITIVO".

Precisiones vía preguntas:
- Problema: el flujo general ("la forma en la que está construido siento que puede tener mejor flujo")
- Referencia: Linear
- Alcance: rediseño profundo

## 2. Diagnóstico del acomodo anterior (por qué era contraintuitivo)

1. **Sidebar plano de ~10 ítems al mismo nivel.** Bandeja, Mis tareas, Calendario, Notas, Pizarras, Metas, Tracking, Oportunidades y Mi CV competían visualmente sin jerarquía. Lo diario (Bandeja, Mis tareas) estaba mezclado con lo ocasional (Mi CV).
2. **Inicio duplicaba el sidebar.** El grid de "Accesos rápidos" repetía los mismos links del sidebar, y montaba un chat de equipo embebido (`DashboardTeamChat`) que costaba 2 queries por equipo en cada carga del dashboard, duplicando la burbuja `FloatingChat` que ya existe global.
3. **Header de proyecto en dos filas con pills.** Título grande + fila de pills grandes para cambiar de vista: gastaba altura vertical y no comunicaba dónde estás dentro de la jerarquía workspace/equipo/proyecto.

## 3. Cambios implementados (archivo:línea)

### 3.1 Sidebar reagrupado — `src/components/sidebar/Sidebar.tsx`

- Patrón Linear: lo más usado arriba, en un clic, SIN grupo: `topItems` con Bandeja y Mis tareas (líneas 101-104).
- Tres grupos colapsables con encabezado tenue: **Workspace** (Inicio, Calendario, Notas, Pizarras, Metas, Tracking, líneas 106-113), **Marketplace** (Oportunidades, Mi CV, líneas 115-118) y **Equipos** (líneas 210-246, sin cambios internos).
- Estado abierto/cerrado por grupo persistido en localStorage, clave nueva `wlo-sidebar-groups-v2` (línea 58) para invalidar estado viejo.
- Componente `NavGroup` nuevo (líneas 258-302): chevron rotatorio, `aria-expanded`, y en modo colapsado (w-14) los encabezados se sustituyen por separadores.

### 3.2 Inicio sin duplicados — `src/app/(app)/w/[workspaceSlug]/page.tsx`

- **Eliminado** el grid de "Accesos rápidos" (duplicaba el sidebar) y la constante `quickActions`.
- **Eliminado** `DashboardTeamChat` (import, carga y JSX): ahorra 2 queries por equipo en cada visita al dashboard. El chat vive en la burbuja flotante global (`FloatingChat`, montada en el layout `w/[workspaceSlug]/layout.tsx:202`).
- Orden nuevo con propósito: saludo → `MiDia` (línea 200) → grid Mis tareas (línea 205) + Actividad (línea 266) → Equipos al final (línea 317).
- Import de lucide reducido a `{ LayoutDashboard }` (línea 12).
- Neto del archivo: 171 líneas menos de las que había.

### 3.3 Header de proyecto compacto — `src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/p/[projectSlug]/page.tsx`

- Breadcrumb en UNA línea: workspace / equipo / icono+nombre del proyecto, cada segmento es link con `max-w-[140px] truncate` (bloque desde línea 282).
- Contenedor sticky: `px-6 pt-3 border-b bg-background sticky top-0 z-10` (línea 283), el contexto no se pierde al scrollear.
- Link discreto "Planeación" al Scrum/Kanban del equipo (líneas 304-311).
- Tabs de vista subrayadas estilo Linear en vez de pills: `ViewToggle` (línea 395) con `border-b-2`, activa `border-primary text-foreground font-medium`, inactiva transparente con hover, y `aria-current="page"`. Nav con `aria-label="Vistas del proyecto"` (línea 316). Vistas: Lista, Tablero, Calendario, Carga, Chat (líneas 317-321), navegación server-side por `?view=` (sin cambio de arquitectura).

## 4. Validación

- `npx tsc --noEmit` → exit 0
- `npx next lint` → exit 0, "No ESLint warnings or errors"
- Los 3 archivos verificados completos del lado Windows (lectura post-escritura por el problema conocido de truncación del mount).
- `git diff --ignore-cr-at-eol` contra `fd903e4` → 0 archivos: el árbol de trabajo es exactamente lo commiteado (las "M" de git status son ruido CRLF del mount, sin contenido real).

## 5. Pasos manuales para publicar (desde Windows, en C:\Users\GRIZZLY\Desktop\TSKR)

1. Borrar locks huérfanos de git si existen (imborrables desde el sandbox):
   - `.git\index.lock` (si reapareció), `.git\HEAD.lock`, `.git\objects\maintenance.lock`
2. `git status` — debe mostrar `ahead 1` (fd903e4). Las "M" masivas son CRLF fantasma; opcional limpiarlas con `git checkout -- .` DESPUÉS de confirmar `git diff --ignore-cr-at-eol` vacío.
3. Commitear este doc (quedó fuera del commit por el HEAD.lock): `git add docs/ROUND4-FLOW-WLO-2026-07-18.md` + `git commit -m "docs: registrar ronda 4"`
4. `git push origin master`
4. Deploy: si el proyecto wlo está git-conectado en Vercel, el push dispara el build solo; si no, `npx vercel --prod`. Proyecto: `wlo` (prj_3Gw2gm9VaxhiVgTI0sOSotp7Vqb8, team developers-pavific).
5. Smoke test en wlo.vercel.app: sidebar con grupos colapsables, Inicio sin accesos rápidos ni chat embebido, y breadcrumb + tabs subrayadas en cualquier proyecto.

## 6. Backlog abierto

- **R4-B**: botón global "Nueva tarea" + atajo `C`. Hoy no existe creación global de tarea (el command palette solo crea equipo/workspace); requiere modal global con selección de proyecto. Se difirió a propósito: es feature nueva, no acomodo.
- Sprint R2-B previo: asignar desde tarjeta, carry-over de sprint.

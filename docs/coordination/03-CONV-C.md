# CONV C — Lógica proyectos/equipos + pulido UX

Dueño exclusivo de: `t/[teamSlug]/page.tsx`, `t/[teamSlug]/p/[projectSlug]/page.tsx`, `projects/page.tsx`, `projects/[projectId]/page.tsx`, `w/[workspaceSlug]/page.tsx` (home). No tocar otros archivos.

## Contexto
Dos superficies de "proyecto" confunden: `/w/[slug]/projects` (marketplace/postulaciones) vs `/w/[slug]/t/[teamSlug]/p/[projectSlug]` (workspace real). Falta jerarquía e intuición. El tablero se percibe escondido desde la vista de equipo/proyecto.

## Tareas

### C1 — Team page: liderar con el tablero + jerarquía clara
- `t/[teamSlug]/page.tsx`: subir el acceso al Tablero (Scrum/Kanban) a elemento primario del header (botón primario, no secundario). Breadcrumb claro Workspace / Equipo.
- Arreglar emoji fallback línea 151: reemplazar `{project.icon ?? '📋'}` por icono lucide (`Hash`) cuando no haya icono. Sin emojis.
- Tarjetas de proyecto: mostrar que son el "trabajo real" (contador de tareas si es barato, o etiqueta de estado ya presente). Minimalista.

### C2 — Aclarar marketplace vs workspace
- `projects/page.tsx` (marketplace): encabezado explícito "Oportunidades internas — postúlate a proyectos abiertos". Diferenciar del trabajo diario. No cambiar la lógica de postulación, solo copy + jerarquía visual.
- `projects/[projectId]/page.tsx`: mantener gestión; asegurar breadcrumb y CTA para "ir al workspace del proyecto" si aplica.

### C3 — Project workspace: acceso al tablero del equipo
- `t/[teamSlug]/p/[projectSlug]/page.tsx`: añadir acceso visible al Tablero del equipo (link a `/t/[teamSlug]/scrum`) para que desde el proyecto se llegue al Scrum/Kanban en 1 clic.

### C4 — Home: surface de actividad WLO y accesos
- `w/[workspaceSlug]/page.tsx`: reforzar accesos rápidos a Tableros de sus equipos (lista compacta de equipos con link directo a su tablero). Mantener MiDia (lo edita Conv B; C solo lo renderiza, no lo modifica). Copy claro, minimalista, iconos lucide.

## Fuera de alcance
- No tocar Sidebar, calendar, MiDia (archivo de B), ScrumWorkspace ni `components/scrum/*`.
- Solo enlazar al tablero por ruta; no modificar su lógica interna.

## Cierre
`npx tsc --noEmit` EXIT:0; revisar imports sin usar y comillas sin escapar en JSX; entrada en `docs/COLAB-CHANGELOG.md` (Conv C R2). No deployar.

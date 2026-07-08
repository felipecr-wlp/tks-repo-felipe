# CONV A — Navegación jerárquica + surfacing de tableros

Dueño exclusivo de: `src/components/sidebar/Sidebar.tsx`, `NavSection.tsx`, `WorkspaceSwitcher.tsx`. No tocar otros archivos.

## Contexto
Sidebar ya agrupa Principal / Espacio / Equipos (colapsables, persistidos en `wlo-sidebar-groups`). Cada equipo (NavSection) despliega Scrum + Chat + proyectos. Problema: el tablero se percibe escondido y la jerarquía Org>Workspace>Equipo>Proyecto no se lee de un vistazo.

## Tareas

### A1 — Aclarar el grupo "Espacio" vs trabajo real
- Renombrar el item `Proyectos abiertos` a `Oportunidades` (es el marketplace de postulaciones, no el workspace). Mantener icono `Compass`, ruta `/w/[slug]/projects` intacta.
- Objetivo: que "Oportunidades" no se confunda con los proyectos de trabajo (que viven bajo cada equipo).

### A2 — Tablero más visible en cada equipo (NavSection)
- El link "Scrum" del equipo debe reflejar el modo real. Como el modo (scrum/kanban) no viaja al sidebar hoy, renombrar el link a `Tablero` (neutral, cubre ambos modos) manteniendo `BoardIcon` y ruta `/t/[slug]/scrum`.
- Subir `Tablero` como PRIMER hijo del equipo (ya lo es) y darle peso visual: cuando el equipo está activo pero ningún hijo lo está, resaltar sutilmente `Tablero` como acción sugerida (borde/acento tenue, sin romper minimalismo).

### A3 — Jerarquía visual del equipo
- En el header del equipo (NavSection) el nombre va en mayúsculas pequeñas; mantener. Añadir indentación/guía visual clara para que Tablero, Chat y proyectos se lean como hijos (línea guía izquierda `border-l` tenue en el contenedor `ml-3`, estilo Linear). Minimalista.

### A4 — Coherencia de iconos
- Verificar que no queden emojis en estos 3 archivos (NavSection ya migró el fallback de proyecto a `Hash`). Todo icono = lucide o SVG inline existente.

## Fuera de alcance
- No tocar team page, project pages, home, ScrumWorkspace ni el calendario.

## Cierre
`npx tsc --noEmit` EXIT:0; revisar imports sin usar; añadir entrada a `docs/COLAB-CHANGELOG.md` (Conv A R2). No deployar.

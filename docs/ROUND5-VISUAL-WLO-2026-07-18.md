# Ronda 5: Sistema visual premium + Nueva tarea global

Fecha: 2026-07-18
Gates: `npx tsc --noEmit` exit 0, `npx next lint` exit 0 (sin warnings).
Sin deploy a produccion: pendiente de revision.

## Frente A: sistema visual

### Tokens (globals.css + tailwind.config.ts)
- Primario indigo tipo Linear: light `235 62% 51%`, dark `235 86% 72%` con foreground oscuro. `--ring` alineado en ambos temas.
- Base tipografica global: antialiasing, `font-feature-settings "rlig" "calt" "tnum"`, `h1-h3` con tracking-tight, `::selection` con tinte de marca.
- Escala de elevacion con intencion (boxShadow):
  - `soft`: tarjetas en reposo.
  - `raised`: dropdowns, menus contextuales, burbujas flotantes.
  - `overlay`: modales, paneles laterales, command palette.

### Aplicacion de la escala (antes -> despues)
| Pantalla / componente | Antes | Despues |
|---|---|---|
| ConfirmDialog | shadow-2xl | shadow-overlay |
| CommandPalette | shadow-2xl | shadow-overlay |
| FloatingChat (panel / burbuja) | shadow-2xl / shadow-xl | shadow-overlay / shadow-raised |
| KernAssistant (panel / lanzador) | shadow-2xl / shadow-lg | shadow-overlay / shadow-raised |
| TaskDetailPanel (panel / 3 menus) | shadow-2xl / shadow-lg | shadow-overlay / shadow-raised |
| ManageCustomFieldsModal, BulkActionBar, ProjectsBoard, CvProjects, MarketplaceBoard (modales) | shadow-2xl / shadow-lg | shadow-overlay |
| Menus: SlashMenu, UserMenu, WorkspaceSwitcher, NotesTreeSidebar, NotesActionsBar, TaskRow (x3), TaskLabels, TaskFilterBar, AssigneesSection, NoteEditor (x2), NoteComments, NoteVersions, ProjectChat, BulkActionBar dropdown | shadow-lg / shadow-xl / shadow-2xl | shadow-raised |
| Dashboard (Mis tareas, Actividad, tarjetas de Equipos) | sin sombra / hover:shadow-sm | shadow-soft en reposo, hover:shadow-raised + hover:border-primary/50 |

Intencionalmente sin tocar: tarjetas Kanban/Scrum (shadow-sm in-flow correcto), comboboxes shadow-md, formularios con shadow-sm de tarjeta.

## Frente B: R4-B Nueva tarea global

- `src/stores/new-task.ts` (nuevo): store zustand `{ open, toggle, setOpen }`.
- `src/components/tasks/GlobalNewTaskModal.tsx` (nuevo): modal con patron de la casa (overlay blur + dialog shadow-overlay), atajo global C (ignora inputs y modificadores), Escape y click-outside cierran, focus automatico en titulo, select de proyecto agrupado por equipo con memoria del ultimo usado (localStorage), prioridad opcional, POST /api/tasks existente, toast de exito y router.refresh.
- `src/app/(app)/w/[workspaceSlug]/layout.tsx`: monta `<GlobalNewTaskModal teams={teams} />` (disponible en todo el workspace).
- `src/components/sidebar/Sidebar.tsx`: boton "Nueva tarea" con kbd C bajo Buscar.

## Archivos tocados (30)

globals.css, tailwind.config.ts, ConfirmDialog, FloatingChat, CommandPalette, SlashMenu, KernAssistant, ManageCustomFieldsModal, BulkActionBar, TaskDetailPanel, UserMenu, WorkspaceSwitcher, NotesTreeSidebar, NotesActionsBar, ProjectsBoard, CvProjects, MarketplaceBoard, TaskRow, TaskLabels, TaskFilterBar, AssigneesSection, NoteEditor, NoteComments, NoteVersions, ProjectChat, dashboard page.tsx, Sidebar, workspace layout.tsx, + nuevos: stores/new-task.ts, tasks/GlobalNewTaskModal.tsx.

Restriccion respetada: sin cambios en docs/spaces del worktree paralelo ni migraciones "spaces*".

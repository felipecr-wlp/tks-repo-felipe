# WLO/TSKR, hoja de ruta a paridad tipo ClickUp

Documento maestro para trabajar la robustez de WLO a lo largo de VARIAS
conversaciones. Cada conversación toma UN track, lo lleva a shippable y lo
deja verificado. Sin guiones largos (regla del proyecto). Iconos lucide, no
emojis. Texto visible en español con ñ y tildes. Cambios aditivos: nunca
romper Scrum, Marketplace, Chat, Notas ni Pizarra.

> Cómo arranca CADA conversación: leer este archivo + `docs/COLAB-CHANGELOG.md`,
> ubicar su track, y ejecutar en circuitos. Cada circuito deja
> `npx tsc --noEmit` y `npx next build` en EXIT 0, hace deploy prod
> (`npx vercel --prod --yes` desde `C:\Users\GRIZZLY\Desktop\TSKR`) y agrega una
> entrada al changelog. REGLA TSKR: Glob/Grep por defecto apuntan al working dir
> WLP, usar rutas absolutas o `cd` a TSKR.

---

## Estado actual (lo que YA existe, no rehacer)

- Tareas: estados custom por proyecto (`status_id`), prioridad
  (urgent/high/medium/low/none), un asignado (`assignee_id`), `due_date`,
  checklist items, comentarios, menciones, adjuntos. Vistas: Lista, Kanban
  (drag and drop), panel de detalle.
- Scrum/Kanban con sprints (`api/sprints`, `ScrumWorkspace`).
- Notas/Wiki: árbol lateral, editor con slash menu, plantillas, iconos lucide
  (registry con fallback legacy), duplicar nota, visibilidad
  (private/project/team/workspace).
- Chat: de equipo (Realtime), de proyecto, burbuja flotante global con
  historial paginado y no leídos, chat embebido en el panel general.
- Pizarra (Excalidraw), Calendario + integración Google Calendar, Inbox y
  notificaciones, presencia, command palette (Cmd+K), búsqueda, workspaces /
  equipos / proyectos, invitaciones, CV/perfil, tracking, Marketplace de
  proyectos internos.

## Brecha vs ClickUp (lo que falta para sentirse igual de fuerte)

Tareas (core PM):
- Multiples asignados por tarea (hoy solo uno).
- Etiquetas / tags con color.
- Subtareas (jerarquia `parent_task_id`).
- Dependencias (bloquea / esperando por).
- Fecha de inicio + estimacion de tiempo por tarea, y time tracking por tarea.
- Tareas recurrentes.
- Campos personalizados (custom fields) por proyecto.
- Watchers / seguidores de una tarea.
- Acciones masivas (bulk) y seleccion multiple.
- Vistas guardadas con filtros (por asignado, prioridad, estado, etiqueta).
- Vista Tabla avanzada, vista Calendario de tareas, vista Gantt / Timeline,
  vista Carga de trabajo (workload).

Colaboracion y docs:
- Edicion colaborativa en vivo de Notas (presencia + cursores) y comentarios
  dentro de la nota.
- Historial / versiones de notas.
- Backlinks: enlazar notas con tareas y proyectos.
- Reacciones (emoji) en mensajes y comentarios.

Automatizacion e inteligencia:
- Reglas / automatizaciones (al cambiar estado, asignar o notificar).
- Recordatorios.
- Metas / OKRs.
- Dashboards y reportes (widgets de avance, burndown ya existe en scrum).
- Notificaciones por email / push (hoy es inbox in-app).

Oficina virtual:
- Espacio embebido de WorkAdventure (avatares + video por proximidad) con la
  API que ya tenemos.

---

## Plan en 3 conversaciones

Cada conversacion es independiente y auto-contenida. Orden sugerido A -> B -> C,
pero pueden correr en paralelo porque tocan zonas distintas del codigo.

### Conversacion A: Notas de nivel Notion/ClickUp Docs

Objetivo: que Notas deje de sentirse basica y sea un sistema de documentacion
robusto. Es lo que Ali marco como prioridad ("la parte de notas").

Circuitos:
1. Robustez del editor y guardado: autosave con estado visible (guardando /
   guardado / error), recuperacion ante fallo de red, y refresco correcto del
   arbol al crear, mover o borrar.
2. Comentarios dentro de la nota (hilo lateral) reutilizando el patron de
   comentarios de tareas. Menciones que notifican al inbox.
3. Backlinks: enlazar una nota con tareas y proyectos, y mostrar "referenciada
   en" al pie de la nota.
4. Historial de versiones: snapshot al guardar (tabla `note_versions`),
   listar y restaurar. Migracion aditiva.
5. Presencia en la nota: quien la esta viendo o editando ahora (Realtime
   presence, reutilizar `usePresence`).

Zona de codigo: `src/app/(app)/w/[workspaceSlug]/notes/**`,
`src/components/editor/**`, `src/components/notes/**`, `src/app/api/notes/**`,
`src/lib/note-templates.ts`.

Criterio de aceptacion: crear, editar, comentar, versionar y enlazar una nota
sin recargar la pagina, con tsc y build en EXIT 0 y deploy prod.

### Conversacion B: Tareas de nivel ClickUp (el core PM)

Objetivo: cerrar la brecha mas grande contra ClickUp en gestion de tareas.

Circuitos:
1. Etiquetas (tags) con color: tabla `task_tags` + `task_tag_links`, UI en el
   panel de detalle y filtro en las vistas.
2. Subtareas: `parent_task_id` en `tasks`, render anidado en Lista y en el
   panel, contador de avance.
3. Dependencias: tabla `task_dependencies` (bloquea / esperando), badges en la
   tarea y aviso al mover a "hecho" con dependientes abiertos.
4. Multiples asignados: tabla `task_assignees` conservando `assignee_id` como
   compat, avatares apilados.
5. Estimacion + fecha de inicio + tiempo registrado por tarea; base para
   workload.
6. Vistas guardadas con filtros (asignado, prioridad, estado, etiqueta) y
   vista Calendario de tareas. Gantt / Timeline queda como circuito final.

Zona de codigo: `src/app/api/tasks/**`, `src/components/tasks/**`,
`src/components/scrum/**`, y migraciones nuevas.

Criterio de aceptacion: una tarea con subtareas, tags, dos asignados, una
dependencia y estimacion, filtrable en una vista guardada, con tsc y build en
EXIT 0 y deploy prod.

### Conversacion C: Colaboracion viva, oficina virtual y automatizacion

Objetivo: la capa que hace que el equipo "viva" en la app.

Circuitos:
1. Oficina virtual WorkAdventure: ruta `src/app/(app)/w/[workspaceSlug]/oficina`
   que embebe la sala via iframe, pasa el `display_name` del usuario, y usa la
   Scripting API (postMessage) para abrir paginas de WLO como co-websites al
   pisar zonas (zona Scrum abre el tablero, zona Wiki abre Notas). Guardar la
   URL de la sala en settings del workspace. Reversible, no toca lo existente.
2. Reacciones (emoji) en mensajes de chat y comentarios: tabla `reactions`
   generica, picker lucide, agregacion por tipo.
3. Automatizaciones basicas: al cambiar estado de tarea disparar accion
   (asignar, notificar, mover de sprint). Motor simple guiado por reglas en DB.
4. Notificaciones por email de menciones y asignaciones (usar el proveedor de
   correo del proyecto), con preferencia por usuario.
5. Dashboard de workspace: widgets de tareas por estado, vencidas, carga por
   persona, actividad reciente.

Zona de codigo: `src/app/(app)/w/[workspaceSlug]/**` (nueva ruta oficina y
dashboard), `src/components/chat/**`, `src/app/api/**` (reacciones,
automatizaciones, notificaciones), `src/lib/activity.ts`.

Criterio de aceptacion: entrar a la oficina y ver avatares con nombre, abrir el
Scrum desde una zona, reaccionar a un mensaje, y recibir email al ser
mencionado, con tsc y build en EXIT 0 y deploy prod.

---

## Reglas de ejecucion (todas las conversaciones)

- Aditivo siempre. Nunca romper Scrum, Marketplace, Chat, Notas, Pizarra.
- Seguridad API: auth 401 -> admin client -> membresia 403 -> columnas
  explicitas + zod + rate limit + IDs desde params (anti-IDOR). Copiar el
  patron de las rutas existentes.
- Migraciones aditivas y con default, nunca destructivas.
- Cada circuito: tsc EXIT 0, build EXIT 0, deploy prod, entrada al changelog.
- Commit por circuito o por track segun pida Ali. Remoto: origin
  (github.com/PAVIFIC/tskr).

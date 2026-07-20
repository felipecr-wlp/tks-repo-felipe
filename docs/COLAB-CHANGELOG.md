# WLO/TSKR — Changelog de colaboración en vivo

Registro de tickets del esfuerzo de hacer WLO verdaderamente colaborativo
(pizarra, tareas, chat, notas, scrum). Orden cronológico inverso.

> Sin guiones largos por regla del proyecto. Cada entrada: fecha, ticket, qué
> cambió, archivos, deploy.

---

## 2026-07-20 — SOP Nivel 2, Paso 2: aprobación / firma de la versión vigente

Un SOP "Activo" ahora lleva una firma responsable, no solo un cambio de estatus:
quién lo aprobó, cuándo, y qué versión se selló. Si después se publica una versión
nueva (cambia `sop_version`), la firma queda "desactualizada" y debe re-firmarse.

Qué cambió:
- Migración `20260720400000_sop_approval.sql` (aplicada a prod): columnas nullable
  `approved_by` / `approved_at` / `approved_version` en `notes`. LANDMINE: `approved_by`
  es uuid SIN FK a propósito. notes ya referencia profiles via created_by; un 2do FK
  notes->profiles haría AMBIGUO el embed `author:profiles(...)` de page.tsx y otras
  rutas (PostgREST HTTP 300 -> notFound() para TODAS las notas). El perfil del
  aprobador se resuelve en la API.
- API `src/app/api/notes/[noteId]/approve/route.ts`: GET (estado: aprobado, quién,
  fecha, versión firmada, desactualizada), POST (admin firma la versión vigente:
  sella approved_by/at/version y pone `sop_status='active'`), DELETE (revoca: limpia
  el sello y regresa a `review`). Admin = org_role owner/admin O rol de workspace
  owner/admin.
- Componente `SopApproval.tsx` montado en `NoteEditor` bajo la barra de metadatos
  (solo doc_kind != note): muestra el estado de la firma con tono verde (firmado) /
  ámbar (desactualizado) / neutro (sin firmar) y, para admins, botones Aprobar y
  activar / Revocar / Re-firmar. Tras firmar hace `router.refresh()` para que la
  barra de estatus (Activo/En revisión) refleje el cambio server-side.

Diseño: iconos lucide, acento azul #2563EB, ñ/tildes correctas, sin guiones largos.
tsc limpio + `next build` OK.
Deploy prod: `dpl_FXC74N8YQoZYCkgazSXEvTre3Nsj` (wlo.vercel.app, READY).

---

## 2026-07-20 — SOP Nivel 2, Paso 1: cumplimiento obligatorio (lectores requeridos)

Sube el acuse de lectura de SOPs de VOLUNTARIO (Nivel 1: cualquiera confirma, sin
exigencia ni visibilidad de faltantes) a OBLIGATORIO: el admin ASIGNA lectores
requeridos (persona, equipo o departamento) y ve el cumplimiento (quién confirmó
la versión vigente vs. quién está desactualizado o pendiente).

Qué cambió:
- Migración `20260720300000_sop_assignments.sql` (aplicada a prod): tabla
  `sop_assignments` (note_id, workspace_id, target_type profile/team/space,
  target_id polimórfico SIN FK por landmine de ciclos PostgREST, assigned_by,
  UNIQUE(note_id, target_type, target_id)). RLS anclada en workspace_members
  (select para miembros, insert/delete solo admins); subqueries solo a OTRAS
  tablas (sin recursión 42P17).
- API `src/app/api/notes/[noteId]/assignments/route.ts`: GET (estado de
  cumplimiento: objetivos con etiqueta y conteo, roster expandido de personas
  requeridas con estatus done/outdated/pending vs `sop_version` vigente, y pools
  de asignación solo para admins), POST (asigna, valida pertenencia al workspace,
  upsert idempotente, notifica `sop_assigned` a cada persona requerida menos a
  quien asigna), DELETE por query. Admin = org_role owner/admin O rol de
  workspace owner/admin.
- Nuevo tipo de notificación `SOP_ASSIGNED = 'sop_assigned'` en
  `src/lib/activity.ts` + etiqueta "debes leer y confirmar:" en el mapa
  VERB_LABELS del inbox (`InboxList.tsx`), para que no rompa la bandeja.
- Componente `SopCompliance.tsx` montado en `NoteEditor` (solo doc_kind != note),
  arriba del acuse voluntario: barra de progreso, chips de objetivos, selector
  personas/equipos/departamentos (admin) y roster con badges de estatus. Se
  autoabastece del GET (`can_assign` decide si muestra el selector), sin props
  extra desde page.tsx.

Diseño: iconos lucide, acento azul #2563EB, ñ/tildes correctas, sin guiones largos.
tsc limpio + `next build` OK.
Deploy prod: `dpl_xsgCJ3fWvkHLDKxiijmUdcz5f6br` (wlo.vercel.app, READY).

---

## 2026-07-20 — Siembra de 6 equipos en WPAV-WORKSPACE

Petición del usuario (Ali): crear en WPAV-WORKSPACE los equipos "WEB UI / UX
TEAM", "SEO TEAM", "GOOGLE ADS TEAM", "SOCIAL MEDIA TEAM", "EMAIL MARKETING TEAM"
y "XTRA MARKETING TEAM", con un panel de control para asignar miembros después.

- Seed directo en producción (tabla `teams`, workspace
  `ee091249-14f8-42b9-a0ae-ce2c7e42ec1b`): 6 equipos sueltos (space_id null, sin
  departamento; reasignables luego desde el panel). Ali queda como admin de cada
  uno (fila en `team_members`). Slugs: web-ui-ux, seo, google-ads, social-media,
  email-marketing, xtra-marketing. Sin deploy de código (los equipos son datos y
  quedan vivos al instante).
- Panel de control para asignar miembros: YA existía y está en producción. En
  `/w/wpav/settings/teams` (TeamsPanel) cada equipo se expande y permite agregar
  o quitar personas del pool del workspace y fijar su rol (admin/miembro), vía
  las APIs `/api/teams/[teamId]/members[/[profileId]]`. Requisito: la persona
  debe ser antes miembro del workspace WPAV (se logra por Sala de espera o
  Invitaciones); solo entonces aparece en el selector para asignarla a un equipo.

---

## 2026-07-20 — Sala de espera (Lobby) para nuevos registros

Deploy de producción: `wlo-iaoiajrsm` (Ready). Build OK, tsc limpio.

Petición del usuario (Ali): "los miembros aún no entran todo, metelos a un lobby
cuando se registren y una vez registrados yo pueda ver el lobby y ubicarlos".

Antes, quien se registraba con un dominio conocido (@pavific.com) entraba
automáticamente al workspace por defecto como member. Ahora se detiene en una
sala de espera hasta que un admin lo ubique.

### Cambio de flujo de alta

- `src/lib/auto-join.ts`: `attemptDomainAutoJoin` (org + workspace) se reemplaza
  por `attemptDomainOrgJoin`, que adhiere el perfil a la ORGANIZACION por
  dominio (profiles.org_id + org_members) pero NO crea `workspace_members`. Los
  miembros existentes no se tocan (ya tienen su fila de workspace).
- Raíz (`page.tsx`) y `onboarding/page.tsx`: sin membresía de workspace ->
  adherir a la org por dominio -> si el perfil ya tiene org_id, va a `/lobby`;
  solo quien no tiene org va a `/onboarding` a crear una.
- `POST /api/onboarding` y `OnboardingForm`: si el dominio ya mapea a una org,
  responde `{ lobby: true }` y el cliente redirige a `/lobby` en vez de crear una
  org paralela.

### Sala de espera del usuario

- `src/app/(app)/lobby/page.tsx` + `LobbyWaiting.tsx`: pantalla de espera con su
  nombre, correo y organización; sondea cada 15s (router.refresh) y, cuando un
  admin lo ubica, el server component lo redirige solo al workspace. Botón de
  revisar y de cerrar sesión.

### Panel de admin para ubicarlos

- Nueva pestaña "Sala de espera" en Configuración (`SettingsNav.tsx`).
- `settings/lobby/page.tsx` + `LobbyPanel.tsx`: lista los perfiles de la org sin
  acceso a ningún workspace; por cada uno el admin elige rol, departamento
  (opcional) y equipo (opcional, filtrado por depto) y lo ubica.
- `POST /api/workspaces/[workspaceId]/lobby` (+ GET): gateado a admin; valida que
  el perfil sea de la misma org, que el depto/equipo vivan en el workspace y que
  el equipo pertenezca al depto elegido; hace upsert idempotente de
  `workspace_members` (+ `space_members` + `team_members` si aplica).

Sin migración: la sala de espera es derivada (perfiles con org_id y sin
`workspace_members`). Las invitaciones por código siguen ubicando directo (no
pasan por el lobby).

---

## 2026-07-20 — Jerarquía Departamento > Equipo + aislamiento duro (F2/F3)

Deploy de producción: `wlo-f5488z6fk` (Ready). Build OK, tsc limpio.

Petición del usuario (Ali): "hazlo como dpto management por favor para tener
varios departamentos y dentro de ese departamento que existan equipos y dentro
de esos equipos hay miembros" + "damelo bien planificado para que nunca en un
bug haya cruce de fronteras" + "si es necesario haz departamentos aislados y si
el admin puede verlo todo pls".

Jerarquía: Workspace > Departamento (space) > Equipo (team) > Miembros. Los
departamentos restringidos quedan sellados; el admin del workspace/org (Ali) lo
ve todo (supervisión).

### F1. Fundamento con fronteras seguras (migración `20260720200000`)

- `teams.space_id uuid NULLABLE` (equipos legacy quedan NULL = visibles a todo
  el workspace, sin cambio). FK COMPUESTA `(space_id, workspace_id)` ->
  `spaces(id, workspace_id)` clava el depto al mismo workspace. Es un ÁRBOL
  (teams -> spaces -> workspaces), NO un ciclo, así que no dispara el HTTP 300
  de PostgREST (landmine 1).
- Helpers `SECURITY DEFINER STABLE`: `is_team_member`, `is_team_admin`,
  `can_see_team`. Evitan la recursión 42P17 (landmine 2) porque bypassa la RLS
  de su propia tabla internamente.
- Policies `teams_select` / `team_members_select`: admin org (owner/admin) O
  `can_see_team(id)`. Defensa en profundidad (RLS + app-code).

### F2. UI de la jerarquía

- Crear equipo dentro de un departamento: `POST /api/teams` acepta `space_id`
  (valida que el depto pertenezca al workspace, 422 si no). Formulario
  `NewTeamForm` con `<select>` de departamentos ("Sin departamento" = visible a
  todo el workspace).
- Reasignar equipo de departamento: `PATCH /api/teams/[teamId]` acepta
  `space_id` (solo admin del workspace, 403 a admins de equipo). Panel
  `settings/teams` agrupa equipos por departamento con encabezado (icono Lock si
  restringido, badge "Aislado", conteo) y un `<select>` por fila para mover.
- Sidebar agrupa equipos por departamento (encabezado con Lock/Building2); los
  equipos sin depto quedan sueltos.

### F3. Aislamiento a nivel de ruta (URL)

- `src/lib/team-access.ts`: para NO-admin, si el equipo está archivado ->
  not-found; si su departamento es restringido y el usuario no es miembro del
  departamento (`space_members`) -> not-found. Misma reja para proyectos vía su
  equipo padre. El admin bypassa (supervisión).

Archivos: migración `20260720200000_teams_departments_isolation.sql`,
`api/teams/route.ts`, `api/teams/[teamId]/route.ts`, `teams/new/page.tsx`,
`teams/new/NewTeamForm.tsx`, `w/[workspaceSlug]/layout.tsx`,
`sidebar/Sidebar.tsx`, `settings/teams/page.tsx`, `settings/teams/TeamsPanel.tsx`,
`lib/team-access.ts`.

---

## 2026-07-20 — Solo el admin crea equipos + Activar/Desactivar equipos

Deploy de producción: alias `wlo.vercel.app`. Build OK, tsc limpio.

Petición del usuario (Ali): "no dejes que otros usuarios generen equipos, solo el
admin puede asignar" + "Activar o desactivar equipos".

### 1. Crear equipos es exclusivo del admin

Antes, cualquier miembro del workspace podía crear equipos (el POST solo validaba
membresía). Ahora la creación es potestad del administrador del workspace, en
tres capas:

- Servidor (garantía dura): `POST /api/teams/route.ts` ahora exige
  `isWorkspaceAdminById(workspace_id)`; devuelve 403 "Solo un administrador puede
  crear equipos" a los no-admin.
- Ruta de creación: `/w/[workspaceSlug]/teams/new/page.tsx` redirige a
  `/w/[slug]` si el usuario no es admin (no ve el formulario).
- UI oculta el punto de entrada "Nuevo equipo" a los no-admin: sidebar
  (`Sidebar.tsx`, nuevo prop `isAdmin`), command palette (`CommandPalette.tsx`,
  acción "Crear equipo" solo admin), home del workspace (`page.tsx`, botón
  "+ Nuevo equipo") y la guía de inicio (`OnboardingGuide.tsx`, el paso "equipos"
  cambia a "Espera a que un admin te asigne un equipo" para el resto).

### 2. Activar / Desactivar equipos (archivado suave)

- Migración `20260720120000_teams_is_archived.sql`: columna
  `is_archived boolean NOT NULL DEFAULT false` + índice parcial de equipos
  activos. Sin FK ni RLS nueva (respeta landmines). Aplicada a prod.
- `PATCH /api/teams/[teamId]` acepta `is_archived` y su gate se amplió: además
  del admin del equipo, ahora también puede editar el admin del workspace
  (consistente con DELETE y con el panel de settings).
- Panel `settings/teams/TeamsPanel.tsx`: botón Activar/Desactivar por equipo
  (iconos Archive/ArchiveRestore) + badge "Inactivo". `settings/teams/page.tsx`
  carga `is_archived`.
- Sidebar (`layout.tsx`): los equipos archivados se OCULTAN a los miembros
  regulares (filtro `is_archived=false` en su query). Los admins los siguen
  viendo atenuados con etiqueta "Inactivo" (`NavSection.tsx`) para poder
  reactivarlos. No se borra nada: tareas, proyectos e historial se preservan.

Archivos: `api/teams/route.ts`, `api/teams/[teamId]/route.ts`,
`teams/new/page.tsx`, `layout.tsx`, `page.tsx`, `OnboardingGuide.tsx`,
`components/sidebar/Sidebar.tsx`, `components/sidebar/NavSection.tsx`,
`components/command-palette/CommandPalette.tsx`,
`settings/teams/TeamsPanel.tsx`, `settings/teams/page.tsx`,
`supabase/migrations/20260720120000_teams_is_archived.sql`.

---

## 2026-07-20 — El admin ya puede ENTRAR a cualquier equipo/proyecto (fix 404)

Deploy de producción: alias `wlo.vercel.app`. Build OK, tsc limpio.

Síntoma reportado: el usuario (admin) abría un equipo desde la sidebar y recibía
"No encontramos eso" (404). Causa: el Punto 1 hizo que la sidebar les muestre a
los admins TODOS los equipos y proyectos del workspace, pero las rutas de
equipo/proyecto seguían llamando a `notFound()` salvo que el usuario fuera
MIEMBRO de ese equipo/proyecto. Un admin que no era miembro veía el equipo pero
no podía entrar.

Fix: helper compartido `src/lib/team-access.ts` con `resolveTeamForViewer` y
`resolveProjectForViewer`. Regla: se puede VER un equipo/proyecto del workspace
si eres miembro de él O admin del workspace (org owner/admin, o
`workspace_members.role` owner/admin). Usa admin client con checks explícitos de
membresía (patrón anti-RLS-loop del resto del app) y verifica coherencia del
`team` de la URL en proyectos. Las 5 rutas de equipo/proyecto quedan cableadas a
este helper (equipo, chat, scrum, proyecto, nuevo proyecto), reemplazando el
lookup por membresía y usando `userId` del contexto.

Además, `POST /api/projects` ya permite crear proyecto a un admin del workspace
aunque no sea miembro del equipo (antes devolvía 403 "Sin acceso al equipo"), vía
`isWorkspaceAdminById`. El creador queda como manager del proyecto (la siembra de
`project_members` ya cubría al creador ausente de `team_members`).

- Nuevo: `src/lib/team-access.ts`.
- Editados: `.../t/[teamSlug]/page.tsx`, `.../chat/page.tsx`, `.../scrum/page.tsx`,
  `.../p/[projectSlug]/page.tsx`, `.../projects/new/page.tsx`,
  `src/app/api/projects/route.ts`.

## 2026-07-20 — Las pizarras incrustadas ahora SÍ salen en el PDF

Deploy de producción: alias `wlo.vercel.app`, Ready. Build OK.

Pregunta del usuario: "lo que dibuje en la pizarra no se imprimirá como PDF?".
En efecto no salía: en el contenido de la nota cada pizarra es solo un
`<div data-whiteboard data-id="...">` vacío (guarda una REFERENCIA a la pizarra,
no la imagen), así que la vista de impresión imprimía un hueco.

Fix: en la vista `/print/notes/[noteId]` un controlador cliente nuevo, tras
montar, busca esos divs, trae la escena de cada pizarra por
`/api/whiteboards/[id]` y la convierte a SVG con `exportToSvg` de Excalidraw,
inyectándola en el div antes de disparar `window.print()`. Fondo blanco forzado
(`exportWithDarkMode:false`, `viewBackgroundColor:#ffffff`) para que imprima
bien. Una pizarra vacía muestra "Pizarra sin contenido"; si una falla no tumba el
resto del PDF (cada una en try/catch). El botón "Guardar como PDF" queda
deshabilitado con estado "Preparando…" hasta que los SVG están pintados.

- Nuevo: `src/app/print/notes/[noteId]/PrintController.tsx` (render de pizarras +
  disparo de impresión).
- Editado: `src/app/print/notes/[noteId]/page.tsx` (usa `PrintController` en vez
  de `PrintTrigger`).
- Eliminado: `src/app/print/notes/[noteId]/PrintTrigger.tsx` (reemplazado).

---

## 2026-07-20 — Pizarra en notas: pasar de inline a MODAL (arregla el dibujo corrido)

Deploy de producción: alias `wlo.vercel.app`, Ready. Build OK.

Síntoma reportado (con captura): al incrustar una pizarra en un SOP, el lienzo se
veía desalineado y las figuras salían corridas/recortadas fuera del área visible;
no se podía dibujar bien. La causa raíz es que Excalidraw mapea las coordenadas
del puntero contra el `getBoundingClientRect` de su contenedor, y montado INLINE
dentro del editor (contenedor con `overflow-y-auto`, layout que se asienta tarde,
nodos `contentEditable` alrededor) esa caja se desalineaba. El `ResizeObserver`
del intento previo no bastó porque el problema no era el ancho sino el offset.

Fix: el lienzo ya NO se monta inline. La nota muestra una tarjeta ligera y el
Excalidraw se abre en un MODAL `fixed inset-0` montado por portal sobre
`document.body`. Anclado al viewport, con caja estable y grande, el mapeo de
coordenadas es correcto: se ve y se dibuja bien. Cierra con Esc o clic en el
backdrop; bloquea el scroll del body mientras está abierto; respeta modo lectura
(`viewModeEnabled`) y el autosave 1.5s por `PATCH /api/whiteboards/[id]`.

- Editado: `src/components/editor/WhiteboardNodeView.tsx` (reescrito a patrón
  tarjeta + modal por portal; se elimina el montaje inline y su ResizeObserver).

---

## 2026-07-20 — Robustecer SOPs Nivel 1, Paso 3: exportar a PDF

Deploy de producción: alias `wlo.vercel.app`, Ready. Build OK, `next lint` limpio.

Cierra el Nivel 1 de robustecimiento de SOPs. Botón "Exportar a PDF" en el editor
de nota que abre una vista de impresión limpia; el usuario elige "Guardar como
PDF" en el diálogo del navegador (sin dependencias nuevas ni chromium en Vercel).

- Nueva ruta `src/app/print/notes/[noteId]/page.tsx` FUERA del layout de la app
  (sin sidebar ni chrome). Auth + acceso propios (sesión + membresía de workspace
  + visibilidad private). Renderiza título, ficha de gobernanza (tipo/estatus/
  versión/próxima revisión) y el contenido (HTML de Tiptap en contenedor `prose`).
- Para documentos operativos (`doc_kind != 'note'`) incluye el REGISTRO DE ACUSES
  de lectura como tabla (persona, fecha, versión reconocida + marca
  "desactualizado"), volviendo el PDF una constancia de capacitación imprimible.
- Nuevo `PrintTrigger.tsx` (cliente): dispara `window.print()` al abrir y ofrece
  botón manual; los controles se ocultan en impresión (`print:hidden`).
- Editado: `NoteEditor.tsx` (botón `FileDown` en la barra de acciones que abre la
  vista de impresión en pestaña nueva).

---

## 2026-07-20 — Tablero de Rendimiento mensual (evaluación por persona y por canal)

Deploy de producción: `dpl_Gh4oNKd36hUupgS3bXwHuMvjCXgM`, alias `wlo.vercel.app`,
Ready. Typecheck EXIT=0, `next lint` limpio, build OK. Commit `eb8cb87`.

Punto 2 (algoritmo de evaluación) + Punto 3 (visibilidad de "cada quien ataca un
proyecto") del pedido de mejora de WLO. Nueva pestaña Configuración -> Rendimiento
(solo admin, gateada por `getWorkspaceAdminContext`).

- Fundamento de datos: columna `tasks.completed_at` + trigger
  `tasks_set_completed_at()` (BEFORE INSERT OR UPDATE OF status_id) que la fija a
  `now()` al entrar a un status `category='done'` (si venía NULL) y la limpia al
  salir. Lee `task_statuses` solo para resolver la categoría (no es policy RLS, sin
  riesgo de recursión 42P17). Backfill conservador de tareas ya cerradas desde
  `updated_at`. Índice `tasks_completed_at_idx(workspace_id, completed_at)`.
  Migración `20260720000000_task_completed_at.sql` (aplicada a prod, verificado).
- Score 0-100 **mensual** por persona sobre tareas cerradas en el mes (por
  `completed_at`): Throughput 25% (volumen), Velocity 30% (`story_points_done`),
  On-time 25% (cerradas en/antes de `due_date`), Estimación 20% (precisión
  `story_points` vs `story_points_done`). Throughput y Velocity son RELATIVOS al
  mejor del mes (normaliza volúmenes distintos entre equipos); On-time y Estimación
  son absolutos 0-100. Los pesos se renormalizan sobre las métricas disponibles
  (si a alguien le falta due_date o puntos, no lo penaliza). Un responsable se
  cuenta desde `tasks.assignee_id` UNION `task_assignees` (multi-asignación).
- Desglose por CANAL/PROYECTO atribuido a su manager (`projects.lead_id` o
  respaldo `project_members.role='manager'`): hace visible quién lleva cada frente
  (ej. Meta, Paid Search) aunque compartan equipo. Resuelve el Punto 3 sin tocar el
  modelo de datos (ya lo soportaba).
- Selector de mes prev/next vía query param `?month=YYYY-MM` (el server component
  recomputa). Empty-states cuando no hay tareas cerradas con responsable.
- Archivos: `.../settings/performance/page.tsx` (server: fetch + cómputo con admin
  client) + `PerformancePanel.tsx` (cliente: tablas + navegación de mes) nuevos;
  `SettingsNav.tsx` editado (pestaña "Rendimiento", icono `Gauge`).

---

## 2026-07-20 — Robustecer SOPs Nivel 1, Paso 2: acuse de lectura

Deploy de producción: alias `wlo.vercel.app`, Ready. Typecheck EXIT=0, build OK.

"Leído y entendido" por empleado sobre cada documento operativo. Cada acuse
sella la `sop_version` reconocida: si el SOP publica una versión nueva, el acuse
queda "desactualizado" y la UI pide re-confirmar.

- Nueva tabla `note_acknowledgements` (migración
  `20260720100000_note_acknowledgements.sql`, aplicada a prod): un acuse por
  `(note_id, profile_id)`, con `sop_version` y `acknowledged_at`. Aditiva, FKs
  unidireccionales a notes/workspaces/profiles (sin ciclos), RLS anclada en
  `workspace_members` (sin recursión). Índices por note/profile/workspace.
- Nueva API `src/app/api/notes/[noteId]/ack/route.ts` (GET estado + lista,
  POST marca leído con upsert `onConflict: note_id,profile_id`, DELETE retira).
  Acceso vía helper `loadNote` (workspace_members + visibilidad private), espejo
  de la ruta de comentarios.
- Nuevo componente `.../notes/[noteId]/SopAcknowledge.tsx`: botón "Leído y
  entendido" (toggle), contador de quién confirmó y aviso de "desactualizado"
  cuando cambió la versión. Se renderiza en `NoteEditor.tsx` solo si
  `doc_kind !== 'note'`.

---

## 2026-07-20 — Robustecer SOPs Nivel 1, Paso 1: recordatorio de revisión

Deploy de producción: `wlo-acam41mkz-developers-pavific.vercel.app` (alias
`wlo.vercel.app`), Ready. Typecheck EXIT=0, build OK.

Cierra el ciclo que en Fase B quedó como MVP visual (la revisión vencida solo se
pintaba en rojo en la lente). Ahora hay un cron diario que crea una notificación
al OWNER del SOP (`created_by`) cuando `review_due` está vencida
(`sop_review_overdue`) o vence dentro de 7 días (`sop_review_due_soon`).

- Nuevo: `src/app/api/cron/sop-reviews/route.ts`. Copia el patrón de
  `due-reminders` (auth por `CRON_SECRET` obligatorio, service-role client,
  dedup por tipo+nota+destinatario en las últimas 20h). Consulta `notes` con
  `doc_kind <> 'note'`, `review_due` no nula y `<= hoy+7d`, excluye
  `sop_status = 'obsolete'`. Idempotente por día.
- Editado: `vercel.json` (segundo cron `/api/cron/sop-reviews` a las 16:00 UTC).
- Editado: `src/lib/activity.ts` (`NotificationTypes.SOP_REVIEW_OVERDUE` y
  `SOP_REVIEW_DUE_SOON`).
- Editado: `.../inbox/InboxList.tsx` (etiquetas de los 2 tipos nuevos; el
  deep-link a `object_type='note'` ya existía y abre el SOP).

---

## 2026-07-20 — Admin gestiona miembros de equipos + ve todos los equipos

**Qué cambió**
- **Gestión de miembros en el panel de equipos** (`/w/[slug]/settings/teams`): cada
  equipo es expandible y permite agregar personas del pool del workspace, cambiar
  su rol de equipo (admin/member) y quitarlas. Cablea las APIs ya existentes
  `/api/teams/[id]/members` (GET/POST) y `/[profileId]` (PATCH/DELETE), gateadas a
  admin, con el guard "debe quedar al menos un admin".
- **Visibilidad total para el admin**: en el layout del workspace, un org
  owner/admin (o admin del workspace) ahora ve TODOS los equipos y proyectos del
  workspace en el sidebar (modo supervisión, vía admin client), no solo donde es
  miembro. El resto de usuarios sigue viendo únicamente lo suyo (inner joins por
  profile_id). No se tocó Kanban/drag-and-drop, Fable ni los espacios restringidos.

**Archivos**
- `src/app/(app)/w/[workspaceSlug]/settings/teams/TeamsPanel.tsx` (member mgmt UI)
- `src/app/(app)/w/[workspaceSlug]/settings/teams/page.tsx` (pasa workspaceId)
- `src/app/(app)/w/[workspaceSlug]/layout.tsx` (org_role + branch admin ve todo)

**Deploy**: commit `99bcff0` -> prod `dpl_GFH4s3MRUjt97GyNvAwQxvP9ZNST` (wlo.vercel.app). tsc + next lint limpios.

---

## 2026-07-20 — FIX pizarra incrustada en notas/SOP (canvas recortado / figuras corridas)

Deploy de producción: `wlo-ftjhzyqt8-developers-pavific.vercel.app` (alias
`wlo.vercel.app`), Ready. Typecheck EXIT=0 y build OK.

Síntoma (reportado por Ali con screenshot en un SOP): al abrir el lienzo dentro
de una nota, el canvas quedaba mal medido; las figuras aparecían corridas y
recortadas a la derecha, se sentía "no funciona".

CAUSA RAÍZ: la pizarra de pantalla completa (`WhiteboardEditor.tsx`) ya tenía un
`ResizeObserver` que re-mide Excalidraw cada vez que su caja cambia; el embed en
notas (`WhiteboardNodeView.tsx`) NO lo tenía, solo refrescaba a 0/120/400 ms.
Dentro de una nota larga (SOP) la caja se asienta DESPUÉS del primer render
(fuentes, tablas, imágenes, scroll), así que Excalidraw se quedaba con un ancho
viejo y las coordenadas del puntero quedaban desalineadas.

FIX: se replicó el mismo `ResizeObserver` en `WhiteboardNodeView.tsx` (nuevo
`canvasWrapRef` sobre el contenedor real del lienzo; se re-llama
`api.refresh()` en cada resize vía requestAnimationFrame). Solo activo cuando el
lienzo está montado (`active && board`). Archivo:
`src/components/editor/WhiteboardNodeView.tsx`.

---

## 2026-07-20 — SOPs de primera clase + plantillas WLP enriquecidas (Fase A + Fase B)

Deploy de producción final: `wlo-qrmfeo2kj-developers-pavific.vercel.app` (alias
`wlo.vercel.app`), estado Ready. Typecheck limpio (`tsc --noEmit` EXIT=0) y build OK
antes de desplegar. Objetivo: que NOE pueda ir metiendo flujos de procesos, SOPs y
capacitaciones dentro de WLO, con estatus, versión y control de revisión.

### Fase A — plantillas de nota WLP enriquecidas
- Editado: `src/lib/note-templates.ts`.
- Las 4 plantillas WLP (Estimate, Job Kickoff, Safety Talk, Closeout) traen contenido
  operativo real (garantía 15 años asfalto / 5 años concreto, margen ~55%). Iconos
  lucide válidos.

### Fase B — SOP como objeto de primera clase

**T1 — Esquema (migración sin FK ni RLS nueva).**
- Nuevo: `supabase/migrations/20260720000000_notes_sop_metadata.sql`. Aplicada a prod
  (ref `cmskiyypeujcgikbvyoz`) vía apply_migration, verificada.
- Agrega columnas nullable a `notes`: `doc_kind` (NOT NULL DEFAULT 'note'),
  `sop_status`, `sop_version`, `review_due` (date). CHECK en `doc_kind`
  (note/sop/sop_flow/sop_index/training) y `sop_status`
  (draft/review/active/obsolete). Índices parciales `notes_doc_kind_idx`
  (WHERE doc_kind<>'note') y `notes_review_due_idx`. RESPETA landmines: sin FK
  (no cierra ciclo, no HTTP 300) y sin policy RLS nueva (la seguridad de un SOP =
  la de una nota normal, ya cubierta por F3).

**T2 — API.**
- Editado: `src/app/api/notes/route.ts` (POST) y `src/app/api/notes/[noteId]/route.ts`
  (GET/PATCH). createSchema y patchSchema (`.strict()`) extendidos con los 4 campos
  (`review_due` valida regex `^\d{4}-\d{2}-\d{2}$`); los 4 campos añadidos a los
  bloques `select` e `insert`. Fix colateral: el select del PATCH había perdido
  `space_id`, reañadido.

**T3 — Barra de metadatos en el editor.**
- Nuevo: `.../notes/[noteId]/SopMetaBar.tsx` (client). Editado: `NoteEditor.tsx`,
  `.../notes/[noteId]/page.tsx`.
- Selector de tipo de documento (nota / SOP / flujo / índice / capacitación, iconos
  lucide FileText/ClipboardList/GitBranch/Library/GraduationCap). Al convertir una
  nota en documento, revela chips de estatus, input de versión e input de fecha de
  revisión, y auto-setea `sop_status='draft'` la primera vez. `review_due` vencido
  se marca visualmente. Cada cambio llama `onPatch()` (PATCH /api/notes/[id]).

**T4 — Lente "Procesos y SOPs".**
- Nuevo: `.../notes/sops/page.tsx` (server) + `.../notes/sops/SopsLens.tsx` (client).
- Vista transversal en `/w/[slug]/notes/sops` de todos los documentos operativos
  (`doc_kind <> 'note'`), filtrable por departamento / tipo / estatus. Cabecera con
  conteos (activos / en revisión / borradores / vencidos) y resaltado de revisiones
  vencidas. Replica el gating de espacios restringidos (blockedSpaceIds). Ruta
  estática, gana sobre `notes/[noteId]`; hereda el layout de notas (árbol lateral).

**T5 — Nav en el sidebar.**
- Editado: `src/components/notes/NotesTreeSidebar.tsx`. Enlace "Procesos y SOPs"
  (icono ClipboardList) entre el switcher de departamento y el árbol, resaltado
  cuando la ruta termina en `/notes/sops`.

**T6 — Plantillas SOP auto-clasificadas.**
- Editado: `note-templates.ts` (campos `docKind`/`sopStatus` en 4 plantillas SOP),
  `NotesActionsBar.tsx` (los pasa en el POST). Las notas creadas desde plantillas
  SOP/flujo/índice/training nacen ya clasificadas y aparecen solas en la lente.

---

## 2026-07-19: INCIDENTE + FIX — caida total "Pagina no encontrada" (404 para TODOS)

Sintoma: `wlo.vercel.app/w/general` daba "Pagina no encontrada" a TODOS los usuarios
(Ali y Alan confirmados), recien logueados. No era sesion ni cache ni cuenta: era
servidor, multiusuario. Se arreglo a nivel de BASE DE DATOS (sin redeploy; el fix vive
en la BD que el app en vivo consulta). Verificado 200 en las 3 formas de query.

CAUSA RAIZ (la introdujo la migracion de auto-join de esta misma fecha,
`20260719000000_org_domain_autojoin`): agregar `organizations.default_workspace_id`
como FK a `workspaces` creo un CICLO de foreign keys
(`workspaces.org_id -> organizations` Y `organizations.default_workspace_id -> workspaces`).
Con dos relaciones entre las mismas tablas, PostgREST responde **HTTP 300 "Multiple
Choices"** en CUALQUIER embed `organizations(...)` bajo `workspaces` (no sabe cual usar).
supabase-js trata el 300 como error -> `data = null`. El layout del workspace
(`(app)/w/[workspaceSlug]/layout.tsx`, query gate con admin client) recibia null y
disparaba `notFound()` para todos. Confirmado en logs de la API de Supabase: 300 en la
query con embed, 200 en la que no lo tiene.

BUG SECUNDARIO destapado al arreglar el 300: recursion infinita de RLS (Postgres
`42P17`) en la policy `workspace_members_select`, cuya 3a clausula hacia subquery a la
MISMA tabla `workspace_members`. Existia desde abril (`20260423100000_fix_rls_circular_dep`),
enmascarada porque el app usa el admin client (service role, bypassa RLS) para TODA
lectura critica; solo se manifestaba como switcher de workspaces vacio en silencio.

Fixes (2 migraciones nuevas, aplicadas a prod + versionadas):
- `20260719010000_drop_circular_org_default_workspace_fk.sql`: `ALTER TABLE organizations
  DROP CONSTRAINT organizations_default_workspace_id_fkey`. La COLUMNA `default_workspace_id`
  y sus datos quedan intactos (auto-join la usa solo como columna, nunca como embed), asi
  que soltar el FK no rompe nada y elimina la ambiguedad. El FK legitimo
  `workspaces_org_id_fkey` se mantiene.
- `20260719020000_fix_workspace_members_select_recursion.sql`: helper `SECURITY DEFINER`
  `public.user_workspace_ids()` (mismo patron que `auth_org_id()`) que lee
  workspace_members SIN re-disparar RLS; la policy usa ese helper en vez del self-subquery.
  Arreglar la policy raiz tambien resuelve la recursion indirecta en `workspaces_select` y
  en la policy DELETE de workspace_members. Tras aplicar DDL: `NOTIFY pgrst, 'reload schema'`.
- Hints defensivos de FK en codigo (no requeridos tras soltar el FK, pero mas robustos):
  `layout.tsx` y `api/invites/[code]/route.ts` cambian `organizations(...)` por
  `organizations!workspaces_org_id_fkey(...)`. Se van con el proximo deploy.

LANDMINE (regla dura, cada migracion futura de TSKR):
- **NUNCA crear un FK que cierre un CICLO entre dos tablas ya relacionadas** (ej. agregar
  `A.x -> B` cuando ya existe `B.y -> A`). PostgREST devuelve HTTP 300 en TODO embed entre
  esas dos tablas y tumba cualquier ruta que las embeba. Si de veras se necesita la columna,
  dejarla SIN constraint FK (como quedo `default_workspace_id`), o desambiguar con hint de
  FK (`tabla!nombre_del_fkey(...)`) en TODOS los embeds afectados (buscar con Grep antes).
- **NUNCA escribir una policy RLS que haga subquery a su PROPIA tabla** (auto-referencia ->
  Postgres `42P17` recursion infinita). Usar un helper `SECURITY DEFINER STABLE SET
  search_path=public` que lea la tabla sin re-disparar RLS. Patron canonico ya en la BD:
  `auth_org_id()`, `user_workspace_ids()`.
- Sintoma-guia: si una ruta autenticada da "Pagina no encontrada" a TODOS de golpe tras una
  migracion, sospechar `notFound()` por query nula, y revisar logs de la API de Supabase
  buscando `300` (ambiguedad de embed) o `42P17` (recursion RLS) ANTES de tocar sesion/cache.

Dato aparte (no era la falla): Alan esta en DOS workspaces con slug `general` (activo
`daf8b859` + residual `ecabb511`); ambos cargan ya. Sigue pendiente consolidar el "general"
residual.

---

## 2026-07-19: Emails transaccionales (andamiaje gateado, invitaciones + notificaciones)

`resend` + `@react-email` estaban en package.json pero SIN una sola linea que los usara ni API key.
Se construyo el andamiaje completo GATEADO por configuracion: si no hay `RESEND_API_KEY` + `EMAIL_FROM`,
todo es no-op silencioso; el dia que se pongan esas env en Vercel + dominio verificado, empieza a enviar
solo sin tocar codigo. Deploy prod `dpl_7HCTp2yB9FdeoJxoX6tKB867AHVQ` (alias wlo.vercel.app, READY).

Modulo nuevo `src/lib/email.ts`:
- `isEmailConfigured()` (gate), `sendEmail({to,subject,html})` best effort (nunca lanza, import perezoso
  del SDK de Resend solo si esta prendido).
- Plantillas de marca (Inter, acento azul #2563EB, sin emojis, ñ/tildes): `renderNotificationEmail`
  (asignacion/mencion/comentario/postulacion/proyecto) y `renderInviteEmail` (invitacion con link).

Notificaciones por correo (cobertura total sin tocar 8 call sites):
- Cableado en el corazon: `src/lib/activity.ts` -> `createNotification` y `notifyTaskWatchers` ahora
  llaman `maybeSendNotificationEmail` (best effort). Un mapa `EMAIL_NOTIFY` filtra a tipos de ALTO valor
  (task_mentioned, note_mentioned, task_commented, application_*, project_approved/rejected/pending);
  los ruidosos/de sistema (task_updated, overdue, due_soon, recurrence, review_requested) NO mandan
  correo. No auto-correo al propio actor. Enlace: tareas -> /w/{slug}/task/{id}, resto -> /w/{slug}/inbox.

Invitaciones por correo (opcional):
- `POST /api/workspaces/[id]/invites` acepta `email` opcional; si se da (y el email esta configurado),
  manda la invitacion con el link `/join/{code}`. El flujo por codigo compartible sigue intacto.
- UI `InvitesPanel.tsx`: campo "Enviar por correo (opcional)"; el toast avisa si se envio.

Archivos: `email.ts` (nuevo), `activity.ts`, `workspaces/[workspaceId]/invites/route.ts`,
`InvitesPanel.tsx`. Sin migraciones. Typecheck + build limpios.

PENDIENTE (solo Ali): poner en Vercel `RESEND_API_KEY` + `EMAIL_FROM` (remitente verificado, ej.
"WLO <notificaciones@pavific.com>") y verificar el dominio en Resend (registros DNS). Hasta entonces
el envio queda apagado a proposito, sin romper nada.

---

## 2026-07-19: Fix alta de usuarios (auto-join por dominio de correo)

Cierra el HALLAZGO ABIERTO de la entrada anterior: quien se registraba SIN invitacion creaba una org
huerfana y quedaba aislado (paso 2 veces, dos "General"; dejo a Alan invisible). Deploy prod
`dpl_49z5s5UWMfaYLr5fdLcZHruW2SYW` (alias wlo.vercel.app, READY).

Solucion (auto-join por dominio):
- La organizacion declara su dominio de correo y su workspace por defecto. Al registrarse alguien con
  ese dominio y sin org, el app lo une AUTOMATICAMENTE a esa org + workspace (rol member) en vez de
  crear una org nueva.
- Migracion `20260719000000_org_domain_autojoin.sql` (aplicada a prod): `organizations.email_domain`
  (text) + `organizations.default_workspace_id` (uuid -> workspaces) + indice unico por lower(dominio)
  (un dominio mapea a lo sumo a una org). La config de datos (pavific.com -> org `06618d0f` + workspace
  activo `daf8b859`) se aplico por SQL aparte, fuera del archivo versionado, para que la migracion sea
  replayable en una BD limpia.
- Helper nuevo `src/lib/auto-join.ts` -> `attemptDomainAutoJoin(admin, user)`: resuelve la org por
  dominio, puebla perfil (solo si no tiene org, sin pisar a nadie), y hace upsert idempotente de
  org_members + workspace_members con rol member. Devuelve el slug para redirigir o null si no aplica.
- Cableado en 3 puntos: `src/app/page.tsx` (raiz, antes de mandar a /onboarding), `onboarding/page.tsx`
  (antes de mostrar el form) y `api/onboarding/route.ts` (defensa: si el dominio ya tiene org, se une
  a ella en vez de crear una duplicada). El camino de invitacion sigue intacto.
- Archivos: `auto-join.ts` (nuevo), `page.tsx`, `(app)/onboarding/page.tsx`, `api/onboarding/route.ts`,
  migracion SQL. Typecheck + build limpios.

---

## 2026-07-19: Asignacion de departamentos (admin) + fix usuario Alan

Ali pidio poder asignar el DEPARTAMENTO a cada persona el mismo (solo admin) y reporto que Alan
Ambriz se logueo pero no aparecia. Deploy prod `wlo-jobg1zpsb` (alias wlo.vercel.app, READY).

Fix usuario Alan (causa raiz):
- Alan (alan.af@pavific.com, id e5c825cb) se registro solo y el onboarding le creo su PROPIA org +
  workspace "General" residual `ecabb511` (quedaba solo ahi). El equipo real vive en el workspace activo
  `daf8b859`. Por eso Ali no lo veia. Se le agrego a `daf8b859` como member (via SQL,
  workspace_members). Ya aparece en la lista de miembros.
- HALLAZGO ABIERTO (bug de onboarding): cualquier persona que se registre SIN invitacion crea una org
  nueva en vez de unirse a la de la empresa. El unico camino correcto de alta es la invitacion
  (/settings/invites -> /api/invites/[code]/join, que sí mete a la org del workspace). Falta un
  auto-join por dominio (@pavific.com) o forzar el flujo por invitacion. Es la 2a vez que pasa (dos
  workspaces "General": daf8b859 activo vs ecabb511 residual).

Asignacion de departamentos (item 3, parte A):
- El panel /settings/departments (ya admin-gated por getWorkspaceAdminContext) ahora deja ASIGNAR y
  QUITAR personas por departamento. La API ya existia (`/api/spaces/[spaceId]/members` GET/POST +
  `/[profileId]` DELETE, todas isWorkspaceAdminById). Solo faltaba el front-end. Boton "Miembros" por
  fila que despliega un selector (personas del workspace aun no asignadas) + lista de asignados con
  "Quitar". Solo admins (Ali) pueden hacerlo, por el gate del area de settings.
- Archivos: `settings/departments/page.tsx` (pasa workspaceMembers), `DepartmentsPanel.tsx` (gestor de
  miembros expandible). Sin migraciones.

---

## 2026-07-19: Especializacion, ronda 2 (plantillas de proyecto: obra + marketing)

Ali pidio especializar WLO para la operacion de pavimentacion Y para marketing (se usa mucho para ambos)
y dejarlo listo para uso real. Deploys prod: `wlo-gxe7dwnaw` (paving) + `wlo-msit0d2wz` (marketing, alias
wlo.vercel.app, READY).

Plantillas incluidas en `PROJECT_TEMPLATES`:
- `paving-job` "Obra de pavimentacion": 11 tareas (visita, estimado, propuesta, contrato, permisos,
  movilizar, base, pavimentar, striping, punch list, cierre) + 6 campos (Direccion, Tipo de superficie,
  Pies cuadrados, Monto, Garantia 15/5 años, Fecha inicio).
- `marketing-campaign` "Campaña de marketing": 11 tareas (brief, research, estrategia, creativos, copy,
  landing, tracking, aprobacion, lanzar, optimizar, reporte) + 6 campos (Canal select 8 opciones,
  Presupuesto, Publico, KPI, Fecha lanzamiento, Estado de aprobacion).
- `content-seo` "Contenido / SEO": 10 tareas (keyword, research, outline, redaccion, on-page, multimedia,
  aprobacion, publicar, indexar, medir) + 6 campos (Keyword, Tipo, Volumen, URL, Fecha, Estado).

Que cambio:
- Nueva libreria `src/lib/project-templates.ts`: define plantillas de proyecto. Primera plantilla
  `paving-job` ("Obra de pavimentacion") con (a) 11 tareas del flujo real de un job (visita a sitio,
  estimado, propuesta, contrato/anticipo, agendar/permisos, movilizar, base/demolicion, pavimentar,
  striping, punch list, cierre/factura/evaluacion) y (b) 6 campos de obra (Direccion, Tipo de superficie
  select asfalto/concreto/mixto, Pies cuadrados, Monto del contrato currency, Garantia select 15/5 años,
  Fecha de inicio). No es tabla nueva: reutiliza tasks + custom_field_definitions existentes.
- `POST /api/projects` acepta `template?` opcional. Tras crear el proyecto y sus statuses, siembra las
  tareas en el primer status "por hacer" (sort_order encadenado con fractional-indexing) y los campos
  personalizados. Best-effort: si la siembra falla, el proyecto ya existe y no bloquea la respuesta.
- `NewProjectForm.tsx`: selector de plantilla arriba del form (En blanco vs Obra de pavimentacion).
  Elegir plantilla ajusta el icono automaticamente y manda `template` al POST.

Archivos: `src/lib/project-templates.ts` (nuevo), `src/app/api/projects/route.ts`,
`src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/projects/new/NewProjectForm.tsx`. Sin migraciones nuevas
(los custom fields ya existian desde `20260713010000_custom_fields.sql` con su UI en TaskDetailPanel).

---

## 2026-07-19: Auditoria de adopcion, ronda 1 (movil + rendimiento)

Ali pidio auditar WLO y aplicar mejoras reales para empezar a usarlo en la empresa.
Auditoria completa: la app ya es funcional y rica; los bloqueadores reales de adopcion eran
movil y un par de N+1. Aplicado en esta ronda (deploy prod `wlo-83xpqjhf9`):

- **BLOQUEADOR movil: la app era inusable en telefono.** El Sidebar era una columna flex fija
  `w-60` sin hamburguesa ni drawer; en 375px comia ~240px y no se podia cerrar. Las cuadrillas
  de campo abren estimados y platicas de seguridad desde el celular. Fix: Sidebar ahora es un
  drawer off-canvas en `< md` (fixed + translate + backdrop, auto-cierre al navegar) y columna
  estatica en desktop. Nueva `MobileTopBar` (hamburguesa + buscar) y store `useMobileNav`.
  Archivos: `components/sidebar/Sidebar.tsx`, `MobileTopBar.tsx` (nuevo),
  `stores/mobile-nav.ts` (nuevo), `w/[slug]/layout.tsx`.
- **Rendimiento home: 6 round trips secuenciales -> `Promise.all`.** El dashboard esperaba
  perfil, equipos, tareas, actividad y 2 conteos uno tras otro. Ahora en paralelo.
  `w/[slug]/page.tsx`.
- **N+1 en Proyectos.** `computeProjectProgress` disparaba ~4 consultas POR proyecto dentro de
  un `.map(async)`. Nueva `computeProjectsProgress(admin, ids[])` calcula todo en 2 consultas
  agregando en memoria. `lib/project-progress.ts`, `w/[slug]/projects/page.tsx`.
- **Skeletons de carga** para Metas, Pizarras y CV (antes daban nav congelada al abrir).

Pendiente propuesto a Ali (especializacion paving, requiere su visto bueno): departamentos como
lente de tareas/proyectos, plantillas de "job" (kickoff -> flujo de tareas sembrado),
campos de proyecto tipo paving (direccion, tipo asfalto/concreto, garantia 15/5), realtime en
Bandeja, y paginacion en listas con tope duro.

---

## 2026-07-19: Persistencia de notas/pizarra + poder eliminar (fix)

Reporte de Ali: "no esta guardando las notas ni la pizarra... no se pueden eliminar notas ni
pizarrones". Diagnostico: los datos SI persistian server-side (verificado en la BD: la nota
"Alan" y la "Pizarra sin titulo" tenian contenido con timestamps frescos). Dos causas reales:

- **Cache del Router (percepcion de "no guarda").** Next 14.2 cachea el RSC de rutas dinamicas
  30s en el cliente por defecto. Al volver (navegacion suave) a una nota o pizarra recien
  editada se mostraba la version vieja "vacia". Fix: `staleTimes: { dynamic: 0, static: 180 }`
  en `next.config.mjs` -> la navegacion siempre re-consulta datos frescos.
- **No se podia eliminar.** El boton de borrar solo se renderizaba para el CREADOR (`isOwner`),
  aunque la API ya permite borrar a creador, admin de workspace u owner/admin de la org. Se
  calcula `canManage` server-side (misma regla que el DELETE) y se pasa al editor; el boton
  ahora aparece para quien realmente puede borrar. Ademas el `handleDelete` de la nota ya no
  bloquea localmente: intenta la API y muestra su error real.
- **Race del embed de pizarra en notas.** `WhiteboardNodeView` montaba Excalidraw aunque la
  escena guardada aun no cargara; su primer `onChange` podia guardar un lienzo en blanco encima
  del real. Fix: no montar hasta tener `board` cargado ("Cargando lienzo...").

Archivos: `next.config.mjs`; `w/[slug]/notes/[noteId]/page.tsx` + `NoteEditor.tsx`;
`w/[slug]/whiteboards/[whiteboardId]/page.tsx` + `WhiteboardEditor.tsx`;
`components/editor/WhiteboardNodeView.tsx`. Deploy prod `dpl_2a66NQ5mBLJcnuHm9ixrXuoaUfwg`.

---

## 2026-07-18: Panel de administracion + guia de inicio + pase estetico (F6/F7/F8)

Tres frentes pedidos por Ali sobre las capturas del dashboard: (a) "NO tenemos panel de
configuraciones nivel admin", (b) "un modulo introductor / una guia al inicio", (c) "mejora
el front, se ve muy simple" + "permiteme visualizar equipos y organizarlos". Modelo de roles
estandar: owner/admin gestionan, member consume. Trabajado en worktree `feat/docs-spaces`.

- **F6a, capa API de administracion** (helper + 6 rutas nuevas, todas gateadas a admin del
  workspace via `isWorkspaceAdminById`, con `applyRateLimit(req,'api')`, zod `.strict()` y
  escrituras `(admin as any)` al estilo de la casa):
  - `src/lib/workspace-admin.ts` (nuevo): `getWorkspaceAdminContext(slug)` (para páginas server) e
    `isWorkspaceAdminById(workspaceId)` (para rutas /api). isAdmin = `org_role` owner/admin O
    `workspace_members.role` owner/admin.
  - `api/workspaces/[workspaceId]/route.ts` (PATCH nombre/descripcion).
  - `api/workspaces/[workspaceId]/members/route.ts` (GET) + `.../members/[memberId]/route.ts`
    (PATCH rol, DELETE). Guardas: no dejar el workspace sin owners; no quitarte a ti mismo.
  - `api/teams/[teamId]/route.ts`: agregado DELETE (gate por workspace admin). Nuevos
    `.../members/route.ts` (GET+POST, valida que el objetivo sea miembro del workspace) y
    `.../members/[profileId]/route.ts` (PATCH rol admin/member, DELETE; no dejar el equipo sin admins).
  - `api/spaces/[spaceId]/route.ts` (PATCH nombre/desc/icono/color/restringido/archivado + DELETE) +
    `.../members/route.ts` (GET+POST) + `.../members/[profileId]/route.ts` (DELETE; no dejar sin owner).
- **F6b, hub de Configuración** en `w/[workspaceSlug]/settings/`: `layout.tsx` (gatea a admins,
  redirige a los demas, provee contenedor + `SettingsNav` de pestañas), y paneles General
  (editar nombre/descripcion), Miembros (cambiar rol/quitar con avatares), Equipos (renombrar,
  metodologia scrum/kanban, eliminar, contador de miembros), Departamentos (crear, renombrar,
  restringir/hacer publico, archivar/restaurar, eliminar). Invitaciones re-encajada dentro del
  layout. Cableado: `UserMenu` recibe `workspaceSlug` y "Configuración" ahora apunta a
  `/w/[slug]/settings` (antes iba a `/settings`, un 404).
- **F7, guia de inicio** (`OnboardingGuide.tsx`): checklist de primeros pasos (crear equipo,
  crear proyecto, invitar, primera nota) que se marca solo con datos reales (conteos de teams,
  projects, workspace_members>1, notes), barra de progreso, tour colapsable "¿Cómo funciona WLO?"
  con enlaces a cada area, cerrable y reabrible (pastilla), estado en localStorage por workspace.
  Reemplaza el viejo empty-state de "crea tu primer equipo" en el dashboard.
- **F8, pase estetico:** empty-states del dashboard con iconos lucide (Mis tareas, Actividad);
  el board Kanban se dejo intacto para no arriesgar el drag-and-drop.
- **Gates:** type-check + lint + build en verde. Sin deps nuevas. Sin migraciones (usa tablas
  existentes: workspaces, workspace_members, teams, team_members, spaces, space_members, profiles).

---

## 2026-07-18: Plantillas WLP + sembrado de departamentos (Confluence real)

Especializacion del Confluence de WLO al negocio de WLP (pavimento), a peticion de Ali.

- **Plantillas de nota especificas de WLP** (`src/lib/note-templates.ts`, +4): `wlp-estimate`
  (Estimacion de obra: cliente/sitio, alcance asfalto/concreto/sealcoating/striping, tonelaje,
  precio y margen objetivo ~55%, garantia asfalto 15 años / concreto 5 años), `wlp-job-kickoff`
  (Arranque de obra: cuadrilla, equipo, materiales, checklist con taskList), `wlp-safety-talk`
  (Charla de seguridad: peligros, PPE, asistencia), `wlp-closeout` (Cierre de obra: estimado vs
  real, margen bruto real, punch list, firma del cliente, lecciones aprendidas). Iconos de claves
  validas del registro lucide (`target`, `clipboard`, `flame`, `chart`), acentos/ñ correctos, sin
  guiones largos. Commit `1f0f2d2`; merge ff a master; deploy prod `wlo-1hediryn9-developers-pavific.vercel.app`.
- **Departamentos WLP sembrados** en el workspace activo `General` (`daf8b859`): 7 espacios en la
  tabla `spaces` via Supabase MCP (org `06618d0f`, `created_by` Ali `5a78b212`, cada uno con su fila
  owner en `space_members`). Publicos: Operaciones y Campo, Estimación y Ventas, Marketing.
  Restringidos (`is_restricted=true`, ocultos por la policy `notes_restrict_space` + filtro app-layer):
  Seguridad, Finanzas, Legal y Contratos, RH y Gente. Cada uno con icono lucide y color de acento.

---

## 2026-07-18: Pase de UX transversal (modales, robustez, responsive, accesibilidad)

Ronda de mejoras de experiencia sobre toda la app, a peticion de Ali ("mejora todo:
pantallas, funciones, flujos"). Trabajado en el worktree `feat/docs-spaces`, merge ff a master.

- **Modales propios en vez de `prompt()` nativo:** nuevo `PromptDialog.tsx` (patron imperativo
  gemelo de `ConfirmDialog`: estado a nivel modulo + `useSyncExternalStore` + `PromptDialogHost`
  montado en el root layout). Reemplaza los 3 `window.prompt` que quedaban: crear departamento
  (`NotesTreeSidebar`), guardar vista (`TaskFilterBar`) y el enlace del editor (luego migrado a
  popover, ver abajo). Soporta validacion inline, autofocus+select, Enter/Escape.
- **Blindaje del embed de pizarra:** nuevo `ErrorBoundary.tsx` reutilizable (class component);
  el `<Excalidraw>` del NodeView va envuelto para que un fallo del lienzo NO tumbe el editor
  entero de la nota (muestra fallback "No se pudo cargar" + Reintentar).
- **Estados de carga y vacio:** skeleton propio al abrir una nota (`notes/[noteId]/loading.tsx`);
  empty state con icono + CTA "Crear primera pagina" en el arbol de notas; empty state en el
  hilo de comentarios ("Aun no hay comentarios. Inicia la conversacion.").
- **Errores silenciosos con toast:** carga de adjuntos (`TaskDetailPanel`) y otros fetch
  secundarios ahora avisan con `toast.error` en vez de fallar en silencio.
- **Responsive:** toolbar del editor con `flex-wrap` (envuelve en pantallas angostas en vez de
  desbordar); arbol de notas `w-52` en movil / `sm:w-64` en desktop. (Kanban ya era responsive
  con `w-[82vw] max-w-[18rem] sm:w-72` + `overflow-x-auto snap-x`.)
- **Accesibilidad:** columnas Kanban como `<section aria-label>` (nombre + conteo), puntos de
  color decorativos `aria-hidden`, botones colapsar/expandir con `aria-label`; input de titulo
  del modal de nueva tarea con `aria-label`.
- **Enlace del editor como popover inline** (en vez de modal bloqueante): input de URL, preview
  clicable que abre en pestana nueva, boton Quitar y normalizacion de URL (antepone `https://`
  si falta protocolo; respeta `mailto:`/`tel:`/rutas). Componente `LinkButton` en `RichTextEditor`.
- Archivos nuevos: `PromptDialog.tsx`, `ErrorBoundary.tsx`, `notes/[noteId]/loading.tsx`.
  Editados: `layout.tsx`, `NotesTreeSidebar.tsx`, `RichTextEditor.tsx`, `TaskFilterBar.tsx`,
  `WhiteboardNodeView.tsx`, `TaskDetailPanel.tsx`, `GoalsView.tsx`, `KanbanBoard.tsx`,
  `GlobalNewTaskModal.tsx`, `NoteComments.tsx`. Sin dependencias nuevas.
- Verificacion en verde en cada tanda (`tsc --noEmit`, `next lint`, `next build`). Commits
  `4f9de0f`, `5be9e5e`, `fe43189`, `d92e4f8`; merge ff a master; deploys prod por Vercel CLI con
  token: `dpl_3n6TxojCuGPDuqkDXh7iBJ8YcV56`, `dpl_8MYfJaNngzYi9LxGY1iHv6XtEBau`,
  `dpl_9AhH7SMnaJjwm1vENUjaFTCjJsKt`, `dpl_6TFJF5nK6VtppToB8Vm5GunKiSb8` (alias `wlo.vercel.app`).

---

## 2026-07-18: Pizarra Excalidraw incrustada en notas (F4)

Robustecimiento estilo Confluence del editor de notas: ahora una nota puede llevar una PIZARRA
(lienzo Excalidraw) incrustada inline, no solo texto. Diseño por REFERENCIA para no duplicar
infraestructura: el bloque Tiptap guarda SOLO el `id` de una pizarra real (tabla `whiteboards` +
API `/api/whiteboards/[id]`), asi el contenido de la nota se mantiene minimo y se reutiliza todo lo
que ya existe (autosave, permisos, pagina de pantalla completa con colaboracion en vivo).

- Nodo `whiteboardEmbed` (`extensions/WhiteboardEmbed.ts`, nuevo): nodo `atom` (hoja) `draggable`,
  guarda `id` + `height`. Comando `setWhiteboard({ id })`.
- NodeView React (`WhiteboardNodeView.tsx`, nuevo): tarjeta ligera con titulo; Excalidraw (~1MB) se
  monta SOLO al hacer click en "Abrir lienzo" (lazy `dynamic(ssr:false)`), igual que Notion/Confluence
  cargan embeds pesados bajo demanda. Autosave debounce 1.5s via PATCH (misma ruta que la pizarra full).
  Header con handle de arrastre, link a pantalla completa (`/w/{slug}/whiteboards/{id}`) y borrar bloque.
  En modo lectura el lienzo entra en `viewModeEnabled`.
- Insertable desde la toolbar (boton PenTool) y el slash-menu (`/pizarra`), solo en el editor `full` y
  cuando hay `workspaceId` (para crear la pizarra real primero). Archivos tocados: `RichTextEditor.tsx`
  (extension + prop `workspaceId` + `createWhiteboard` + boton), `SlashMenu.tsx` (comando dinamico
  pizarra), `NoteEditor.tsx` (pasa `workspaceId`).
- Sin dependencias nuevas (Excalidraw y `@tiptap/react` ya estaban). Verificacion en verde
  (`tsc --noEmit`, `next lint`, `next build`; ruta `notes/[noteId]` 14.4 kB). Commit `777b9df`, merge ff
  a master (`7012056..777b9df`), push a `origin/master`, deploy prod por Vercel CLI con token
  (`dpl_77sY1R4Y4rL5nzTPbopbWhB9rQG2`), alias `wlo.vercel.app`.

---

## 2026-07-18: Confluence real, vertical Docs por departamentos (F0 a F3)

Vertical de "Confluence de verdad" en el módulo de notas, segmentado por AREAS/DEPARTAMENTOS
(distintos de los equipos operativos). Trabajado en worktree aislado `feat/docs-spaces` para no
colisionar con el sistema visual global de Fable en master (R5); al final rebase limpio sobre la R5
y merge fast-forward (los archivos solapados eran CRLF puro, 0 cambios reales). Cuatro fases:

- F0: capa de datos espacios=departamentos. Tablas `spaces` y `space_members`, columna `space_id` en
  `notes`, helpers `is_space_member(sp_id)`/`is_space_admin(sp_id)` (SECURITY DEFINER) y RLS aditiva.
  Migración `20260718120000_spaces_departments.sql`, alineada al patrón RLS de prod. Tipos en
  `src/lib/supabase/types.ts`. API `src/app/api/spaces/route.ts` (GET/POST).
- F1: navegación por departamentos en el árbol del wiki. `NotesTreeSidebar.tsx` con switcher de
  departamento; el layout de notas carga espacios visibles.
- F2: editor enriquecido de notas (bloques wiki), gateado por `blocks="full"` para que las
  descripciones de tareas sigan lean. Tablas redimensionables, callouts (info/warn/success/tip, sin
  emoji por regla), toggles con `<details>` nativo (colapso lo maneja el navegador, sin JS extra).
  Slash-menu filtrado por schema (solo muestra bloques disponibles). Estilos container-scoped en
  `RichTextEditor.tsx` (NO en globals.css, para no chocar con Fable). Archivos: `RichTextEditor.tsx`,
  `SlashMenu.tsx`, `extensions/Callout.ts` (nuevo), `extensions/Details.ts` (nuevo), `NoteEditor.tsx`.
- F3: ocultamiento ESTRICTO de espacios restringidos por rol (confidencialidad por depto, ej. RH,
  Legal). Como las policies PERMISSIVE se combinan con OR, la policy base `notes_select` dejaba ver
  notas `workspace` aunque vivieran en un espacio restringido; se cierra con una policy RESTRICTIVE
  `notes_restrict_space` (combina con AND). Sin escape por `created_by`: si te sacan del espacio dejas
  de ver sus páginas aunque las escribieras (segmentación estricta, intencional). Como el app lee con
  admin client (bypassa RLS), se replica el filtro en las 3 rutas app-layer: `notes/layout.tsx` (árbol),
  `api/notes/route.ts` (lista) y `api/notes/[noteId]/route.ts` (detalle GET/PATCH/DELETE, cierra acceso
  directo por URL). Migración `20260718130000_spaces_restricted_notes.sql`.
- Ambas migraciones ya aplicadas a la DB de prod y verificadas. Verificación combinada en verde
  (`tsc --noEmit`, `next lint`, `next build`; ruta `notes/[noteId]` 14.4 kB). Merge ff a master
  (`4483f77..758f4c4`), push a `origin/master`, deploy prod por Vercel CLI con token, alias
  `wlo.vercel.app`.

---

## 2026-07-14: Loop premium, Circuitos B41 a B43 (tres frentes en paralelo)

Se trabajaron tres mejoras al mismo tiempo (agentes aislados por worktree, luego ensamblados en
master con historia lineal y una sola verificación combinada de tsc y next build antes del deploy).

- B41: avatares apilados para multiples asignados. La consulta del server component de la página
  de proyecto ahora trae `task_assignees ( profile:profiles (...) )` y normaliza un arreglo
  `assignees` por tarea. Nuevo componente `StackedAvatars` (hasta 3 círculos superpuestos con anillo
  del color de la tarjeta más chip `+N`); cae al asignado único si no hay arreglo, sin regresiones.
  Archivos: `page.tsx` del proyecto, `KanbanBoard.tsx`, `TaskRow.tsx`, `TaskListView.tsx`,
  `StackedAvatars.tsx` (nuevo).
- B42: vistas de Calendario y Carga de trabajo con el mismo lenguaje visual premium (barras de
  progreso con gradiente, badges de fecha, lecturas de salud, estados hover).
  Archivos: `TaskCalendarView.tsx`, `TaskWorkloadView.tsx`.
- B43: tablero de sprints (Scrum) con el lenguaje visual premium.
  Archivo: `ScrumWorkspace.tsx`.
- Verificación combinada en verde (`tsc --noEmit` y `next build`, ruta de proyecto 20.8 kB, ruta de
  scrum 22.9 kB). Deploy prod desde `C:\Users\GRIZZLY\Desktop\TSKR`, alias `wlo.vercel.app` (el
  primer intento se colgó en Vercel, el reintento compiló en 1m).

---

## 2026-07-13: Loop premium, Circuito B29 (foco visible global para navegación por teclado)

Veintitresavo circuito. Auditoría encontró 0 usos de `focus-visible` y 34 archivos con `outline-none`
sin un reemplazo consistente: un usuario navegando con Tab (teclado, o accesibilidad) perdía por
completo la referencia de qué elemento tenía el foco en buena parte de la app. En vez de tocar 34
archivos uno por uno (riesgo de inconsistencia), se resolvió con una sola regla global en
`globals.css` sobre el pseudo-selector `:focus-visible`: un ring de 2px offset (mismo patrón visual
que shadcn/ui) que usa las variables de tema `--background`/`--ring` ya existentes, así que respeta
claro/oscuro sin CSS adicional. Al ser `:focus-visible` (no `:focus`), el ring solo aparece con
teclado, nunca al hacer click con mouse, entonces no agrega ruido visual a la mayoría de usuarios ni
compite con los `outline-none` locales (son propiedades distintas, outline vs box-shadow).

- Archivos: `src/app/globals.css` (regla `:focus-visible` global en la capa base).
- Sin migración. `npx next build` en verde. Deploy prod desde `C:\Users\GRIZZLY\Desktop\TSKR`.

---

## 2026-07-13: Loop premium, Circuito B28 (error/404 on-brand, sin pantallas genéricas de Next.js)

Veintidosavo circuito, sigue el foco en UI premium tras B27. La app no tenía NINGÚN `error.tsx` ni
`not-found.tsx` propio: 12 puntos del código llaman `notFound()` (proyecto, tarea, nota, equipo,
pizarra invalidos, etc.) y cualquier excepción no controlada, y en ambos casos el usuario caía en la
pantalla genérica de Next.js (o el stack trace en dev), rompiendo por completo la marca. Ahora hay
boundaries on-brand en dos niveles: uno global (`src/app/not-found.tsx`, `src/app/error.tsx`) para
fuera del contexto de workspace, y uno a nivel workspace (`src/app/(app)/w/[workspaceSlug]/not-found.tsx`,
`.../error.tsx`) que al ser sibling del layout con el Sidebar lo mantiene montado cuando el error viene
de una página hija, así el usuario no pierde el contexto de navegación. El error boundary incluye botón
"Reintentar" (usa el `reset()` que da Next.js) y loguea a consola; el 404 explica que el recurso no
existe o no se tiene acceso, con link de vuelta al inicio.

- Archivos nuevos: `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/(app)/w/[workspaceSlug]/not-found.tsx`,
  `src/app/(app)/w/[workspaceSlug]/error.tsx`.
- Sin migración. `npx tsc --noEmit` y `npx next build` en verde. Deploy prod desde `C:\Users\GRIZZLY\Desktop\TSKR`.

---

## 2026-07-13: Loop premium, Circuito B27 (skeletons de carga en rutas pesadas)

Veintiunavo circuito, foco en UI premium y percepción de velocidad. La app no tenía NINGÚN
`loading.tsx` en todo el App Router: al navegar a un proyecto, scrum, notas, calendario, tracking,
mis tareas, marketplace de proyectos o inbox, la pantalla se quedaba en blanco hasta que el Server
Component terminaba de traer los datos (perceptible sobre todo en proyectos con muchas tareas). Ahora
cada una de esas rutas tiene su propio `loading.tsx` que Next.js monta automáticamente como boundary
de Suspense, mostrando un skeleton con shimmer (`animate-pulse`) que respeta la forma real del
contenido (columnas de kanban, filas de lista, grid de calendario, tarjetas de marketplace). El
sidebar y la topbar del layout persisten sin parpadeo, solo el área de contenido muestra el skeleton.
De paso, el fallback del `dynamic()` del tablero Kanban (que antes era el texto plano "Cargando
tablero...") ahora usa el mismo primitivo de skeleton para que la transición data-lista a JS-del-tablero
se sienta continua.

- Archivos: `src/components/ui/Skeleton.tsx` (nuevo, primitivo compartido con shimmer), `loading.tsx`
  nuevo en: `t/[teamSlug]/p/[projectSlug]`, `t/[teamSlug]/scrum`, `notes`, `calendar`, `tracking`,
  `my-tasks`, `projects`, `inbox`. `t/[teamSlug]/p/[projectSlug]/page.tsx` (fallback del dynamic import
  de KanbanBoard usa Skeleton en vez de texto).
- Sin migración. `npx tsc --noEmit` y `npx next build` en verde. Deploy prod desde `C:\Users\GRIZZLY\Desktop\TSKR`.

---

## 2026-07-13: Loop premium, Circuito B26 (tareas recurrentes)

Veinteavo circuito. WLO no tenía forma de repetir una tarea: recordatorios semanales, cierres
mensuales o checklists diarias había que recrearlas a mano cada vez. Ahora una tarea puede marcarse
como recurrente (diaria, semanal, cada 2 semanas o mensual) desde el panel de detalle, con fecha
límite opcional para cortar la serie. El disparador es por evento, no por cron: cuando el PATCH de
`/api/tasks/[taskId]` mueve la tarea a un estado de categoría `done` y la tarea tiene una regla de
recurrencia activa, la API clona la tarea de inmediato con la siguiente fecha calculada, la coloca en
la primera columna del proyecto, conserva asignado/prioridad/regla, y notifica al asignado (nuevo tipo
`task_recurrence_created` en el inbox). Si la próxima fecha calculada supera `recurrence_end_date`, la
serie no continúa. Se agregó también un badge (ícono Repeat) en tarjetas del tablero y filas de la
lista para identificar tareas recurrentes de un vistazo, siguiendo el mismo patrón visual que el badge
de subtareas de B20/B24.

- Migración: `supabase/migrations/20260713000000_task_recurrence.sql` (columnas `recurrence_rule`
  con CHECK enum, `recurrence_end_date`, índice parcial). Aplicada directamente al proyecto Supabase
  de producción vía MCP (`apply_migration`).
- Archivos: `src/lib/recurrence.ts` (nuevo: reglas, labels, cálculo de siguiente fecha), `src/lib/activity.ts`
  (nuevo tipo de notificación `TASK_RECURRENCE_CREATED`), `src/app/(app)/w/[workspaceSlug]/inbox/InboxList.tsx`
  (label del nuevo tipo), `src/app/api/tasks/[taskId]/route.ts` (Zod schema, select de GET/PATCH ampliado,
  lógica de spawn de la siguiente ocurrencia tras completar), `src/components/tasks/TaskDetailPanel.tsx`
  (control "Repetir" + fecha límite, toast al generarse la siguiente ocurrencia), `src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/p/[projectSlug]/page.tsx`
  (query agrega `recurrence_rule`), `src/components/tasks/KanbanBoard.tsx`, `TaskListView.tsx`, `TaskRow.tsx`
  (badge de recurrencia en tablero y lista).
- `npx tsc --noEmit` y `npx next build` en verde. Deploy prod desde `C:\Users\GRIZZLY\Desktop\TSKR`
  (`npx vercel --prod --yes`, READY, alias `wlo.vercel.app`).

---

## 2026-07-11: Loop premium, Circuito B25 (búsqueda por título en la vista de lista)

Diecinueveavo circuito. El tablero Kanban ganó búsqueda por título con atajo `/` en B19/B21, pero la
vista de lista no tenía ninguna forma de filtrar: en proyectos con muchas tareas había que scrollear a
mano. Ahora la lista tiene un input de búsqueda (ícono Search, botón X para limpiar, Escape limpia y
desenfoca) que filtra las tareas por título en cliente, reflejando el patrón del tablero. Durante una
búsqueda activa se ocultan los grupos de estado sin coincidencias y el "+ Nueva tarea" inline, y si nada
coincide se muestra un estado vacío "Sin coincidencias" con el término buscado.

- Archivos: `src/components/tasks/TaskListView.tsx` (import Search/X, estado `search`, `visibleTasks`
  filtrado, input, estado vacío de búsqueda, ocultar grupos vacíos e inline-create en búsqueda).
- Sin migración. `npx tsc --noEmit` y `npx next build` en verde. Deploy prod desde `C:\Users\GRIZZLY\Desktop\TSKR`.

---

## 2026-07-11: Loop premium, Circuito B24 (progreso de subtareas en la vista de lista)

Dieciochoavo circuito. En B20 el tablero Kanban ya mostraba en cada tarjeta un badge de progreso de
subtareas (ej. `2/5` con ícono ListChecks, verde al completarse). La vista de lista NO lo mostraba: la
misma tarea se veía con subtareas en el tablero y sin señal alguna en la lista, una inconsistencia
visual. Ahora `TaskRow` renderiza el mismo badge, justo antes de la fecha de vencimiento, alimentado
por los campos `subtaskTotal`/`subtaskDone` que la página servidor ya calcula (query agregada única en
`page.tsx`, sin N+1). Aditivo: si la tarea no tiene subtareas el badge no aparece.

- Archivos: `src/components/tasks/TaskRow.tsx` (import ListChecks, interface Task + campos, badge antes
  de la fecha), `src/components/tasks/TaskListView.tsx` (interface Task + campos para que fluyan al row).
- Sin migración. `npx tsc --noEmit` y `npx next build` en verde. Deploy prod desde `C:\Users\GRIZZLY\Desktop\TSKR`.

---

## 2026-07-11: Loop premium, Circuito B23 (tablero responsivo en móvil)

Diecisieteavo circuito. El tablero usaba columnas de ancho fijo `w-72` con padding `px-6`, cómodo en
escritorio pero apretado en móvil. Ahora en pantallas chicas cada columna ocupa `82vw` (máx 18rem) con
scroll horizontal por deslizamiento y snap (`snap-x snap-mandatory`), el patrón estándar de Kanban
móvil (ves una columna a la vez y deslizas), volviendo a `w-72` sin snap desde `sm`. Padding y gaps se
reducen en móvil (`px-3 sm:px-6`, `gap-3 sm:gap-4`). Aditivo, solo clases responsivas de Tailwind, sin
cambios de lógica ni esquema. Deja `tsc` y `next build` en EXIT 0.

### Qué cambió
- `KanbanColumn`: ancho `w-[82vw] max-w-[18rem] sm:w-72` + `snap-start`.
- Contenedor de columnas: `gap-3 sm:gap-4 px-3 sm:px-6` + `snap-x snap-mandatory sm:snap-none`.
- Barra de filtros: `px-3 sm:px-6`.

### Archivos
- `src/components/tasks/KanbanBoard.tsx`

### Deploy
- `npx tsc --noEmit` EXIT 0, `npx next build` EXIT 0, `npx vercel --prod --yes` READY.

---

## 2026-07-11: Loop premium, Circuito B22 (recordatorios de fecha de entrega, cron diario)

Dieciseisavo circuito. Faltaba cualquier aviso proactivo de fechas: una tarea vencía y nadie se
enteraba salvo mirando el tablero. Se agregó un cron diario (08:00 PT / 15:00 UTC) que recorre las
tareas activas con asignado y fecha, y crea una notificación en la bandeja del asignado cuando la tarea
está VENCIDA (`task_overdue`) o vence dentro de 24h (`task_due_soon`). Idempotente por día: deduplica
contra notificaciones del mismo tipo+tarea+destinatario de las últimas 20h, así una corrida repetida no
genera spam. Recordatorio del sistema, sin actor (`subject_id: null`, la bandeja muestra "Sistema").
Aditivo, sin esquema (reutiliza la tabla `notifications`). Deja `tsc` y `next build` en EXIT 0.

### Qué cambió
- `src/app/api/cron/due-reminders/route.ts` (NUEVO): GET protegido opcionalmente por `CRON_SECRET`
  (Vercel Cron envía el `Authorization: Bearer` automáticamente si la variable existe; si no, corre sin
  protección con advertencia). Lee tasks `is_archived=false`, con `assignee_id` y `due_date <= now+24h`,
  excluye categoría `done`, clasifica overdue/due_soon, deduplica e inserta notificaciones.
- `vercel.json`: bloque `crons` con `path: /api/cron/due-reminders`, `schedule: "0 15 * * *"`.
- `src/lib/activity.ts`: `NotificationTypes.TASK_OVERDUE` y `TASK_DUE_SOON`.
- `InboxList`: etiquetas de verbo para los dos tipos nuevos ("tarea vencida:", "vence pronto:").

### Archivos
- `src/app/api/cron/due-reminders/route.ts` (nuevo)
- `vercel.json`
- `src/lib/activity.ts`
- `src/app/(app)/w/[workspaceSlug]/inbox/InboxList.tsx`

### Deploy
- `npx tsc --noEmit` EXIT 0, `npx next build` EXIT 0, `npx vercel --prod --yes` READY.
- Nota: para blindar el endpoint, definir `CRON_SECRET` en el entorno de Vercel (opcional).

---

## 2026-07-11: Loop premium, Circuito B21 (atajo de teclado + estado vacío de búsqueda)

Quinceavo circuito. Dos mejoras de pulido premium en el tablero: (1) atajo de teclado "/" que enfoca
el campo de búsqueda desde cualquier parte del tablero (patrón tipo Linear), ignorado si ya estás
escribiendo en un campo o si hay un panel de tarea abierto; Escape dentro del campo limpia y desenfoca.
Se muestra una tecla "/" sutil dentro del input como pista. (2) Estado vacío claro cuando los filtros o
la búsqueda no arrojan ninguna tarea: antes cada columna mostraba su placeholder ("suelta una tarea
aquí"), lo cual confundía al filtrar; ahora se reemplazan las columnas por un mensaje centrado "Sin
coincidencias" con botón para limpiar filtros. Aditivo, sin esquema. Deja `tsc` y `next build` en EXIT 0.

### Qué cambió
- `KanbanBoard`: `useRef` para el input de búsqueda + efecto global `keydown` para "/"; `onKeyDown`
  Escape en el input; pista `<kbd>/</kbd>` cuando el campo está vacío.
- Estado vacío "Sin coincidencias" (ícono `Search` + botón limpiar) que sustituye las columnas cuando
  `filtersActive && visibleTasks.length === 0`.

### Archivos
- `src/components/tasks/KanbanBoard.tsx`

### Deploy
- `npx tsc --noEmit` EXIT 0, `npx next build` EXIT 0, `npx vercel --prod --yes` READY.

---

## 2026-07-11: Loop premium, Circuito B20 (progreso de subtareas en tarjetas del tablero)

Catorceavo circuito. Las tarjetas del Kanban no mostraban señal de subtareas; una tarea con hijas se
veía igual que una sin ellas. Se agregó un indicador de progreso (ícono `ListChecks` + "hechas/total")
en cada tarjeta que tiene subtareas, verde cuando están todas completadas. El conteo se calcula en el
server component del proyecto con una sola consulta acotada (todas las tareas con `parent_task_id` en
los ids visibles), agregada en JS a un mapa padre -> {total, done} usando la categoría del estado
(`done`). Aditivo, sin esquema. Deja `tsc` y `next build` en EXIT 0.

### Qué cambió
- `page.tsx` del proyecto: tras aplanar tareas, nueva consulta `tasks.in('parent_task_id', parentIds)`
  con `status:task_statuses(category)`; agregación a mapa de conteos y asignación de `subtaskTotal` /
  `subtaskDone` a cada tarea de nivel superior.
- `KanbanBoard`: `Task` gana `subtaskTotal?` / `subtaskDone?`; la tarjeta renderiza un badge con
  `ListChecks` y "done/total", coloreado en verde cuando está completo.

### Archivos
- `src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/p/[projectSlug]/page.tsx`
- `src/components/tasks/KanbanBoard.tsx`

### Deploy
- `npx tsc --noEmit` EXIT 0, `npx next build` EXIT 0, `npx vercel --prod --yes` READY.

---

## 2026-07-11: Loop premium, Circuito B19 (búsqueda de tareas en el tablero)

Treceavo circuito. El tablero ya filtraba por prioridad y asignado; faltaba búsqueda por texto. Se
agregó un campo de búsqueda por título en la barra de filtros (client-side sobre las tareas ya
cargadas, sin llamada de red). Nota: el circuito de @menciones en comentarios (item pendiente #4) ya
estaba implementado de antes (autocompletar en el composer + endpoint `/mentions`), así que no
requirió trabajo. Aditivo, sin esquema. Deja `tsc` y `next build` en EXIT 0.

### Qué cambió
- `KanbanBoard`: nuevo estado `search`; `visibleTasks` ahora también descarta tareas cuyo título no
  contiene el texto (case-insensitive). `filtersActive` incluye la búsqueda y `clearFilters` la
  limpia.
- Campo de búsqueda con ícono `Search`, botón de limpiar y expansión al enfocar, ubicado junto a la
  etiqueta "Filtrar".

### Archivos
- `src/components/tasks/KanbanBoard.tsx`

### Deploy
- `npx tsc --noEmit` EXIT 0, `npx next build` EXIT 0, `npx vercel --prod --yes` READY.

---

## 2026-07-11: Loop premium, Circuito B18 (editar y eliminar comentarios)

Doceavo circuito. Los comentarios de tarea solo se podían crear, no editar ni borrar. Ahora el
autor puede editar en línea (textarea con Cmd/Ctrl+Enter para guardar, Esc para cancelar) y eliminar
(con confirmación de un clic que expira en 3s). Aditivo, sin cambios de esquema (la tabla
`task_comments` ya tenía `updated_at`). Deja `tsc` y `next build` en EXIT 0.

### Qué cambió
- Nuevo endpoint `api/tasks/[taskId]/comments/[commentId]/route.ts` con `PATCH` (editar) y `DELETE`.
  Ambos: rate limit, auth 401, y verificación de que el comentario existe, pertenece a esa tarea y
  el usuario es el autor (403 si no). PATCH valida body con zod (1..5000), actualiza `content` +
  `updated_at` y devuelve el comentario mapeado a `body`.
- `TaskDetailPanel`: `handleEditComment` (PATCH + reemplazo en estado) y `handleDeleteComment`
  (borrado optimista con reversión si falla).
- `CommentItem` reescrito: botones editar/eliminar visibles al hover solo para comentarios propios;
  edición en línea con textarea; eliminación con confirmación de un clic.

### Archivos
- `src/app/api/tasks/[taskId]/comments/[commentId]/route.ts` (nuevo)
- `src/components/tasks/TaskDetailPanel.tsx`

### Deploy
- `npx tsc --noEmit` EXIT 0, `npx next build` EXIT 0 (ruta del endpoint registrada),
  `npx vercel --prod --yes` READY.

---

## 2026-07-11: Loop premium, Circuito B17 (la bandeja abre la tarea)

Onceavo circuito. La bandeja de notificaciones tenía un TODO: al hacer clic en una notificación de
tarea solo hacía `router.refresh()` en vez de abrir la tarea. Ahora sí abre el `TaskDetailPanel` de
esa tarea. Como la bandeja no conoce la ruta del proyecto (solo el id de la tarea), se agregó un
resolutor server-side que mapea tarea -> proyecto -> equipo y redirige al tablero con `?task=<id>`.
Aditivo, sin cambios de esquema. Deja `tsc` y `next build` en EXIT 0.

### Qué cambió
- Nueva ruta resolutora `w/[workspaceSlug]/task/[taskId]/page.tsx`: resuelve la tarea, verifica que
  el usuario sea miembro del proyecto y hace `redirect()` a
  `/w/<ws>/t/<team>/p/<project>?view=board&task=<id>`. Si la tarea no existe o no hay acceso,
  `notFound()`.
- `page.tsx` del proyecto lee `searchParams.task` y lo pasa como `initialTaskId` a `KanbanBoard` y
  `TaskListView`.
- `KanbanBoard` y `TaskListView` aceptan `initialTaskId?` e inicializan `selectedTaskId` con él, así
  el panel abre al montar sin efecto extra.
- `InboxList.handleClick` para notificaciones de tarea ahora hace
  `router.push('/w/<ws>/task/<id>')` en vez del `router.refresh()` que era un TODO.

### Archivos
- `src/app/(app)/w/[workspaceSlug]/task/[taskId]/page.tsx` (nuevo)
- `src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/p/[projectSlug]/page.tsx`
- `src/components/tasks/KanbanBoard.tsx`
- `src/components/tasks/TaskListView.tsx`
- `src/app/(app)/w/[workspaceSlug]/inbox/InboxList.tsx`

### Deploy
- `npx tsc --noEmit` EXIT 0, `npx next build` EXIT 0 (ruta `/w/[workspaceSlug]/task/[taskId]`
  registrada), `npx vercel --prod --yes` READY.

---

## 2026-07-11: Loop premium, Circuito B16 (persistir orden al reordenar en el tablero)

Décimo circuito. Bug real del tablero: `handleDragEnd` solo hacía PATCH de `status_id`, así que
reordenar tarjetas DENTRO de una columna no se guardaba (al refrescar volvían a su lugar). Ahora
el orden se persiste con índice fraccional. Autocontenido en `KanbanBoard.tsx`; el endpoint PATCH
ya aceptaba `sort_order`, no hubo cambios de API ni esquema. Deja `tsc` y `next build` en EXIT 0.

### Qué cambió
- `handleDragEnd` calcula el nuevo `sort_order` con `generateKeyBetween` (paquete
  `fractional-indexing`, ya usado server-side al crear tareas) entre los vecinos de la posición
  donde se soltó. Soltar sobre una tarjeta inserta justo antes de ella; soltar en el área/columna
  vacía manda al final.
- Se calcula sobre la lista COMPLETA de la columna (no la filtrada) para que el orden sea
  coherente aunque haya filtros activos ocultando vecinos.
- Las columnas ahora se renderizan ordenadas por `sort_order` (`byOrder`), así el reordenamiento
  optimista se refleja al instante.
- PATCH manda siempre `sort_order`; `status_id` solo si cambió de columna. Revierte con
  `setTasks(initialTasks)` si falla.

### Archivos
- `src/components/tasks/KanbanBoard.tsx`. Import nuevo: `generateKeyBetween` de `fractional-indexing`.

### Deploy
- `npx vercel --prod --yes` (READY). Commit + push a `origin master`.

---

## 2026-07-11: Loop premium, Circuito B15 (barra de filtros del tablero)

Noveno circuito. Continuación de "mejora el tablero, agrega funciones": el tablero ahora tiene
una barra de filtros client-side arriba de las columnas. Todo autocontenido en `KanbanBoard.tsx`
(sin esquema, APIs ni queries nuevas). Aditivo: no rompe nada del flujo existente. Deja
`tsc --noEmit` y `next build` en EXIT 0.

### Funciones nuevas
- **Filtrar por prioridad:** pills Urgente/Alta/Media/Baja (multi-selección) con el punto de
  color de `PRIORITY_META`.
- **Filtrar por asignado:** fila de avatares de los miembros del proyecto; toggle con anillo
  primario cuando está activo. Un asignado nulo se agrupa como `__none__` internamente.
- **Solo mías:** atajo que togglea al usuario actual en el filtro de asignado.
- **Contador + limpiar:** cuando hay filtros activos muestra "N de M" tareas visibles y un botón
  "Limpiar" para resetear.

### Implementación
- Estado `priorityFilter` y `assigneeFilter` (`Set<string>`). Se deriva `visibleTasks` filtrando
  la copia local antes de agrupar por columna, así el dnd y el realtime siguen operando sobre la
  lista completa (`tasks`) sin conflicto.
- Layout reestructurado a `flex-col`: barra de filtros arriba, franja de columnas
  (`overflow-x-auto`) abajo. `TaskDetailPanel` es overlay `fixed`, no le afecta el cambio.

### Archivos
- `src/components/tasks/KanbanBoard.tsx`. Íconos lucide `Filter`, `X`.

### Deploy
- `npx vercel --prod --yes` (READY). Commit + push a `origin master`.

---

## 2026-07-11: Loop premium, Circuito B14 (tablero Kanban premium + funciones)

Octavo circuito del loop premium. Petición directa de Ali: "mejora el tablero, haz la vista más
premium, mejora y agrega funciones". El tablero se rediseñó y ganó funciones nuevas, todo
autocontenido en `KanbanBoard.tsx` (sin tocar esquema, APIs ni queries del server component).
Aditivo: no rompe Scrum, Marketplace, Chat, Notas, Pizarra ni el flujo de tareas. Deja
`tsc --noEmit` y `next build` en EXIT 0.

### Bug real corregido
- **Soltar en columnas vacías ya funciona.** Antes `KanbanColumn` no registraba `useDroppable`,
  así que una columna sin tarjetas no tenía `over` para su status id y el drop se perdía. Ahora
  cada columna es droppable (`useDroppable({ id: status.id })`) y resalta al arrastrar encima
  (`isOver`: fondo tenue + borde punteado del color primario).

### Funciones nuevas
- **Colapsar/expandir columnas.** Estado cliente `collapsed: Set<string>`. Una columna colapsada
  se vuelve una barra angosta (w-11) con el punto de color, el conteo y el nombre en vertical;
  clic para expandir. Header con botón de colapsar que aparece al hover.
- **Placeholder de columna vacía.** Mensaje guía ("Suelta una tarea aquí o créala abajo", o
  "Nada aquí todavía" en la columna done) en lugar de un hueco vacío.

### Rediseño premium
- **Tarjetas:** meta de prioridad (`PRIORITY_META`) con punto de color + etiqueta ("Urgente",
  "Alta", etc.), fecha con icono `CalendarDays` y énfasis rojo si está vencida, avatar del
  asignado con anillo, y micro-interacción al hover (`-translate-y-0.5` + sombra).
- **Headers:** nombre en semibold, pill de conteo con `tabular-nums`, estilo atenuado para la
  categoría done.
- **DragOverlay:** ahora refleja el acento de prioridad y muestra la etiqueta, no solo el título.

### Archivos
- `src/components/tasks/KanbanBoard.tsx`: reescrito (props, exports, realtime, dnd optimista,
  `CreateTaskInline` y `TaskDetailPanel` intactos). Íconos lucide `CalendarDays`, `ChevronLeft`,
  `ChevronRight`.

### Deploy
- `npx vercel --prod --yes` (READY). Commit + push a `origin master`.

---

## 2026-07-11: Loop premium, Circuito B13 (notificar a seguidores en comentarios)

Séptimo circuito del loop premium: cerrar el hueco de notificaciones. Hasta B12, los
seguidores (B10/B11) solo recibían aviso cuando cambiaba un CAMPO de la tarea (PATCH), no
cuando alguien COMENTABA, que suele ser el evento colaborativo más importante. Ahora un
comentario nuevo notifica a todos los seguidores (menos al autor) con su propia frase en la
bandeja. Aditivo: no toca tasks, asignados, Scrum, Marketplace, Chat, Notas ni Pizarra. Deja
`tsc --noEmit` y `next build` en EXIT 0.

### Lib (parametrizar el notificador)
- `src/lib/activity.ts`: `notifyTaskWatchers` acepta un `notifType` opcional (por defecto
  `TASK_UPDATED`). Se agregó `NotificationTypes.TASK_COMMENTED = 'task_commented'` para que la
  bandeja distinga "comentó" de "actualizó".

### API
- `src/app/api/tasks/[taskId]/comments/route.ts` (POST): tras insertar el comentario, llama a
  `notifyTaskWatchers({ ..., notifType: TASK_COMMENTED })` (best effort, no bloquea). El autor
  se excluye solo (la función filtra al actor), así que quien comenta no se auto-notifica.

### UI
- `src/app/(app)/w/[workspaceSlug]/inbox/InboxList.tsx`: nueva etiqueta
  `'task_commented': 'comentó en la tarea que sigues'` en `VERB_LABELS`.

---

## 2026-07-11: Loop premium, Circuito B12 (historial de actividad en el panel)

Sexto circuito del loop premium: un feed de actividad por tarea en el panel de detalle.
Cada mutación de tarea ya se registraba en `activity_events` (via `logActivity`), pero no
había forma de VERLO. Ahora el panel muestra una línea de tiempo "quién hizo qué y cuándo"
(avatar + frase legible + hace-cuánto). Es el complemento visible de las notificaciones de
seguidores (B10/B11): el seguidor recibe el aviso en la bandeja y aquí ve exactamente qué
cambió. Aditivo: no toca tasks, comentarios, asignados, Scrum, Marketplace, Chat, Notas ni
Pizarra. Deja `tsc --noEmit` y `next build` en EXIT 0.

### API (lectura anti-IDOR)
- `src/app/api/tasks/[taskId]/activity/route.ts` (nuevo): GET devuelve hasta 50 eventos de
  `activity_events` del objeto (object_type='task', object_id=taskId), más recientes primero,
  con el actor (`subject:profiles`) resuelto y el `metadata` del evento. Valida acceso por
  `checkTaskAccess` (404 si no existe, 403 si no eres miembro del proyecto) con el admin client.

### Log de comentarios (enriquece el feed)
- `src/app/api/tasks/[taskId]/comments/route.ts` (POST): ahora también llama a
  `logActivity(COMMENT_ADDED)` (best effort) para que los comentarios aparezcan en el historial,
  no solo los cambios de campo. Se añadió `title` al select de la tarea para el `object_title`.

### UI (línea de tiempo autocontenida)
- `src/components/tasks/TaskActivitySection.tsx` (nuevo): autocontenido por `taskId`, lee el
  endpoint y pinta una timeline compacta (avatar de 20px + línea conectora + frase). Para
  `task.updated` afina la frase con el `metadata` del PATCH (mapea `status_id` -> "cambió el
  estado", `priority` -> "cambió la prioridad", etc.; agrupa "cambió N campos"). Si no hay
  eventos, no renderiza nada (cero ruido). Se recarga cuando el padre incrementa `refreshKey`.
- `src/components/tasks/TaskDetailPanel.tsx`: nuevo estado `activityKey` que se incrementa tras
  guardar un campo (`updateField`) o agregar un comentario (`handleAddComment`), y se pasa como
  `refreshKey` a la sección, que va debajo de Comentarios en la columna de contenido.

---

## 2026-07-11: Loop premium, Circuito B11 (auto-seguimiento en interacciones)

Quinto circuito del loop premium: el auto-seguimiento (auto-watch) que hace útil a B10.
En ClickUp/Linear, interactuar con una tarea te vuelve seguidor automáticamente, para que
recibas notificaciones de cambios futuros sin tener que dar "Seguir" a mano. Ahora en WLO,
tres acciones te suscriben a la tarea de forma idempotente: comentarla, ser asignado a ella,
y crearla (además del asignado inicial si se define al crear). Con esto los seguidores de B10
se pueblan solos y las notificaciones de `notifyTaskWatchers` (que dispara cada PATCH) llegan
a la gente correcta sin fricción. Aditivo: no toca tasks, comentarios, asignados, Scrum,
Marketplace, Chat, Notas ni Pizarra. Deja `tsc --noEmit` y `next build` en EXIT 0.

### Lib (helper best effort)
- `src/lib/watchers.ts` (nuevo): `autoWatch(admin, taskId, projectId, profileId)` hace upsert
  en `task_watchers` con `onConflict: 'task_id,profile_id', ignoreDuplicates: true`, así que es
  idempotente (segura de llamar en cada interacción, sin duplicar). Captura sus propios errores
  y no lanza: jamás debe romper el flujo principal (comentar, asignar, crear). Reutiliza el
  admin client del handler; la autorización ya se verificó por membresía de proyecto antes.

### API (enganches en 3 rutas, best effort, no bloqueantes)
- `src/app/api/tasks/[taskId]/comments/route.ts` (POST): quien comenta pasa a seguir la tarea,
  usando el `task.project_id` ya obtenido para la verificación de acceso.
- `src/app/api/tasks/[taskId]/assignees/route.ts` (POST): el nuevo asignado sigue la tarea,
  usando `access.projectId` de `checkTaskAccess`.
- `src/app/api/tasks/route.ts` (POST): el creador sigue la tarea recién creada; si se define un
  `assignee_id` inicial distinto del creador, ese asignado también la sigue.
  Todas las llamadas son `autoWatch(...).catch(console.error)` para no bloquear la respuesta.

---

## 2026-07-11: Loop premium, Circuito B10 (seguidores/watchers de tarea)

Cuarto circuito del loop premium: una tarea puede tener SEGUIDORES (watchers), como en
ClickUp/Notion. En el panel de detalle aparece un botón "Seguir / Siguiendo" y los avatares
apilados de todos los que la siguen. Al seguir una tarea, la persona recibe una notificación
en su bandeja cada vez que la tarea se actualiza (cualquier PATCH), aunque no sea el asignado.
Así te enteras de los cambios de una tarea que te importa sin tener que estar asignado a ella.
Aditivo: no toca tasks, asignados, Scrum, Marketplace, Chat, Notas ni Pizarra. Deja
`tsc --noEmit` y `next build` en EXIT 0.

### Base de datos (migración aditiva)
- `supabase/migrations/20260711040000_task_watchers.sql` (nueva): tabla `task_watchers`
  (id, task_id -> tasks cascade, project_id -> projects cascade, profile_id -> profiles
  cascade, created_at) con UNIQUE (task_id, profile_id). RLS anclada en el proyecto
  (mismo patrón que message_reactions): select para miembro del proyecto/workspace o
  admin/owner; insert y delete solo para la propia persona. `REPLICA IDENTITY FULL` y alta
  en la publicación `supabase_realtime` para futuros usos en vivo.

### API (patrón anti-IDOR en capas)
- `src/app/api/tasks/[taskId]/watchers/route.ts` (nuevo): GET lista los seguidores + si YO
  sigo; POST alterna MI propio seguimiento. `applyRateLimit` -> auth 401 -> `checkTaskAccess`
  (403/404). `profile_id` sale del usuario autenticado y `project_id` se deriva de la tarea,
  nunca del body.
- `src/app/api/tasks/[taskId]/route.ts`: el PATCH ahora llama `notifyTaskWatchers` (best
  effort) tras actualizar, para avisar a los seguidores (menos al actor).

### Lib
- `src/lib/activity.ts`: nueva función `notifyTaskWatchers` (inserta filas en `notifications`
  para cada watcher salvo el actor) y nuevo tipo `NotificationTypes.TASK_UPDATED = 'task_updated'`.

### UI
- `src/components/tasks/WatchersSection.tsx` (nuevo): botón Seguir/Siguiendo (íconos lucide
  Eye/EyeOff) + avatares apilados de seguidores, autocontenido por taskId.
- `src/components/tasks/TaskDetailPanel.tsx`: nueva MetaRow "Seguidores" en la columna de
  metadatos, debajo de Asignados.
- `src/app/(app)/w/[workspaceSlug]/inbox/InboxList.tsx`: etiqueta para el tipo `task_updated`
  ("actualizó la tarea que sigues").

---

## 2026-07-11: Loop premium, Circuito B9 (reacciones con emoji en el chat)

Tercer circuito del loop premium: el chat del proyecto gana reacciones con emoji al
estilo Slack/ClickUp. Al pasar el cursor sobre un mensaje aparece un disparador que
abre un picker con 8 emojis; al elegir uno se agrega o se quita (toggle) y aparece un
pill con el conteo debajo del mensaje. Todo en tiempo real: las reacciones de los demás
llegan sin recargar por el mismo canal de realtime del chat. Update optimista con
reversión si el POST falla. Aditivo: no toca el envío de mensajes, Scrum, Marketplace,
Notas ni Pizarra. Deja `tsc --noEmit` y `next build` en EXIT 0.

### Base de datos (migración aditiva)
- `supabase/migrations/20260711030000_message_reactions.sql` (nueva): tabla
  `message_reactions` (id, message_id -> project_messages cascade, project_id -> projects
  cascade, profile_id -> profiles cascade, emoji, created_at) con UNIQUE
  (message_id, profile_id, emoji) para un toggle idempotente. RLS anclada en el proyecto
  (miembro del proyecto o de su workspace, o admin/owner). `REPLICA IDENTITY FULL` para
  que los DELETE de realtime traigan project_id/message_id en el payload y el cliente
  pueda filtrar y quitar el pill correcto. Se añade a la publicación `supabase_realtime`.

### API (patrón anti-IDOR en capas)
- `src/app/api/projects/[projectId]/messages/[messageId]/reactions/route.ts` (nuevo): POST
  toggle. `applyRateLimit` -> auth 401 -> acceso al proyecto 403 -> el mensaje debe ser de
  ESTE proyecto (404 si no) -> emoji validado contra whitelist (zod enum). `profile_id` sale
  del usuario autenticado, nunca del body. Si ya existe la reacción se borra; si no, se inserta.

### UI
- `src/components/chat/ProjectChat.tsx`: nuevo prop `initialReactions`, estado `reactions`,
  agrupación por mensaje/emoji (conteo + si es mía + quiénes), dos subscripciones realtime más
  (INSERT y DELETE de `message_reactions`), `toggleReaction` optimista, picker al hover y pills
  con conteo. Íconos lucide (`SmilePlus`).
- `src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/p/[projectSlug]/page.tsx`: carga inicial de
  reacciones (una consulta acotada por proyecto) y las pasa al `ProjectChat`.

---

## 2026-07-11: Loop premium, Circuito B8 (acciones masivas / multi-seleccion)

Segundo circuito del loop premium: la vista de lista gana selección múltiple con
checkbox por fila (aparece al hover o cuando ya hay selección) y una barra flotante
anclada al fondo que aplica un mismo cambio a todas las tareas marcadas: estado,
prioridad, asignado, o eliminar (archivar) en lote. Soporta selección por rango con
Shift (marca todo lo que hay entre la última tarea y la actual en el orden visual).
Feature de poder estilo ClickUp. Aditivo: no toca Scrum, Marketplace, Chat, Notas ni
Pizarra; las filas siguen abriendo el detalle y editándose inline igual que antes.
Deja `tsc --noEmit` y `next build` en EXIT 0.

### API (patrón anti-IDOR en dos capas)
- `src/app/api/projects/[projectId]/tasks/bulk/route.ts` (nuevo): POST. `applyRateLimit`
  -> auth 401 -> membresía del proyecto 403 -> zod (`discriminatedUnion` sobre el tipo de
  acción: status/priority/assignee/delete, hasta 100 taskIds). Capa 2: filtra los taskIds a
  los que realmente pertenecen al proyecto (`eq project_id` + `in ids`) antes de mutar, así
  ningún id externo se toca aunque se cuele. Valida además que la statusId sea del proyecto y
  que el nuevo asignado sea miembro. Delete = soft archive (`is_archived = true`), coherente
  con el borrado individual.

### UI
- `src/components/tasks/BulkActionBar.tsx` (nuevo): barra flotante con contador, menús de
  estado/prioridad/asignado y botón eliminar (con confirmación). Íconos lucide.
- `src/components/tasks/TaskRow.tsx`: props opcionales `selected`, `selectionActive`,
  `onToggleSelect`; checkbox a la izquierda que respeta Shift (pasa `e.shiftKey`).
- `src/components/tasks/TaskListView.tsx`: estado `selectedIds` + `lastSelectedId`, lógica de
  selección por rango sobre el orden visual plano, y montaje de la barra cuando hay selección.

---

## 2026-07-11: Loop premium, Circuito B7 (Vista de Carga de Trabajo / Workload)

Primer circuito del loop de mejora premium: el proyecto gana una quinta vista, "Carga",
que agrupa las tareas activas por su asignado principal y muestra, por persona, la carga
estimada en horas (a partir de `estimate_minutes` del circuito B5), el número de tareas
abiertas, las vencidas, y una barra apilada por categoría de estado. Da al líder una
lectura inmediata de quién está saturado y quién tiene holgura. Incluye tres tarjetas de
resumen global (abiertas, carga estimada, vencidas) y filas expandibles que revelan las
tareas de cada persona (clic abre el TaskDetailPanel). Vista de solo lectura, aditiva: no
toca Scrum, Marketplace, Chat, Notas ni Pizarra, y las vistas Lista/Tablero/Calendario/Chat
siguen igual. Sin migración (reusa datos ya cargados). Deja `tsc --noEmit` y `next build`
en EXIT 0.

### Archivos
- `src/components/tasks/TaskWorkloadView.tsx` (nuevo): componente cliente. Construye buckets
  por asignado (incluye bucket "Sin asignar"), calcula minutos estimados de tareas no
  terminadas, cuenta vencidas comparando `due_date` contra hoy en hora local, y ordena por
  mayor carga. Barra apilada por categoría (todo/in_progress/done/cancelled) + indicador
  relativo de carga en horas (rojo si hay vencidas). Realtime vía `useRealtimeRefresh`.
- `src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/p/[projectSlug]/page.tsx`: se añade
  `estimate_minutes` al tipo `TaskRow` y al `.select` de tareas; nuevo `ViewToggle` para
  `?view=workload` con `LoadIcon`; rama de render que monta `TaskWorkloadView`.

---

## 2026-07-11: Conversación B, Circuito B6 (vistas guardadas + calendario)

Sexto y último circuito de la Conversación B: el proyecto gana una barra de filtros
(estado, prioridad, asignado) aplicados server-side vía searchParams, vistas guardadas
privadas por usuario (combinación nombrada de filtros + tipo de vista) y una vista de
Calendario mensual estilo Gantt ligero que coloca cada tarea según su rango
`[start_date, due_date]` en barras apilables por carril. Aditivo: no toca Scrum,
Marketplace, Chat, Notas ni Pizarra, y las vistas Lista/Tablero/Chat siguen igual.
Deja `tsc --noEmit` y `next build` en EXIT 0.

### Capa de datos (migración aditiva)
- Migración `add_task_saved_views`: tabla nueva `task_saved_views` (`id`, `project_id`,
  `profile_id`, `name`, `filters` jsonb, `created_at`) con índice `(project_id, profile_id)`.
  RLS habilitada; el acceso real se valida en cada handler con el admin client (anti-IDOR).

### API (patrón anti-IDOR)
- `src/app/api/projects/[projectId]/saved-views/route.ts`: GET (lista las vistas propias del
  proyecto) y POST (crea una). `applyRateLimit` -> auth 401 -> membresía 403 -> zod. Los
  filtros se validan (status uuid, priority enum, assignee uuid, view string) antes de guardar.
- `src/app/api/projects/[projectId]/saved-views/[viewId]/route.ts`: DELETE. Borra solo si la
  vista es del usuario (`profile_id`) y del proyecto de la ruta, para que nadie borre las de otro.

### Página del proyecto (server component)
- `src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/p/[projectSlug]/page.tsx`: el select de tareas
  ahora incluye `start_date`; se aplican filtros `priority` y `assignee` además de `status`;
  se cargan las vistas guardadas del usuario; se monta `<TaskFilterBar>` (excepto en chat) y un
  cuarto toggle `?view=calendar` que renderiza `<TaskCalendarView>`.

### UI (iconos lucide, texto en español con ñ/tildes)
- `src/components/tasks/TaskFilterBar.tsx`: componente nuevo. Selects de Estado/Prioridad/Asignado
  que empujan searchParams, botón "Guardar vista" (POST) y menú de vistas guardadas (aplicar/borrar).
- `src/components/tasks/TaskCalendarView.tsx`: componente nuevo. Rejilla mensual (semana inicia en
  lunes), navegación mes anterior/Hoy/siguiente, barras por tarea coloreadas por estado/prioridad,
  apiladas en carriles greedy cuando se traslapan, clic abre el `TaskDetailPanel`. Aritmética de
  días con `Date` local, sin dependencias externas. Muestra conteo de tareas sin fecha.

---

## 2026-07-11: Conversación B, Circuito B5 (estimación, fecha inicio y tiempo)

Quinto circuito de la Conversación B: cada tarea gana una estimación de esfuerzo, una
fecha de inicio y una sección de tiempo registrado (timer arranca/detiene, alta manual en
minutos y total acumulado por el equipo). El backend de time tracking ya existía
(`/api/time-entries/*` + tabla `time_entries` del módulo `/tracking`); aquí solo se agrega
un resumen por tarea y se reutilizan sus endpoints de escritura. Aditivo, no toca Scrum,
Marketplace, Chat, Notas ni Pizarra. Deja `tsc --noEmit` y `next build` en EXIT 0.

### Capa de datos (migración aditiva)
- Migración `add_task_estimate_and_start_date`: agrega a `tasks` las columnas
  `estimate_minutes` (integer) y `start_date` (timestamptz). Ambas nullable, sin default
  destructivo. Se reutiliza la tabla existente `time_entries` para el tiempo real.

### API (patrón anti-IDOR)
- `src/app/api/tasks/[taskId]/time/route.ts`: ruta nueva GET. Devuelve el total de segundos
  del equipo en la tarea, la lista de entradas (con autor) y el id del timer propio en curso.
  `applyRateLimit` -> auth 401 -> admin -> `checkTaskAccess`. Solo lectura; la escritura
  sigue en `/api/time-entries/{start,stop}` y POST `/api/time-entries` (ya existentes).
- `src/app/api/tasks/[taskId]/route.ts`: GET y PATCH ahora incluyen `start_date` y
  `estimate_minutes` en el select y el schema zod (`estimate_minutes` int 0..1e6 nullable,
  `start_date` datetime nullable), para que el estado del panel no los pierda al guardar.

### UI (iconos lucide, texto en español)
- `src/components/tasks/TimeTrackingSection.tsx`: componente nuevo. Total formateado (2h 15m),
  botón Iniciar/Detener el timer, alta manual en minutos y últimas entradas con avatar.
- `src/components/tasks/TaskDetailPanel.tsx`: filas nuevas "Inicia el" (date) y "Estimacion"
  (`EstimateField`, acepta "2h", "90m", "1h30m" o minutos sueltos) en la columna de metadatos;
  se monta `<TimeTrackingSection>` en el cuerpo, antes del Checklist.

---

## 2026-07-11: Conversación B, Circuito B4 (múltiples asignados)

Cuarto circuito de la Conversación B: una tarea puede tener VARIOS asignados, con
avatares apilados en el panel y un menú para agregar/quitar personas del proyecto. Se
conserva `tasks.assignee_id` como "asignado principal" para no romper las vistas que aún
leen un solo asignado (tablero, listas, scrum): el endpoint lo mantiene sincronizado.
Aditivo, no toca Scrum, Marketplace, Chat, Notas ni Pizarra. Deja `tsc --noEmit` y
`next build` en EXIT 0.

### Capa de datos (migración aditiva con backfill)
- Migración `add_task_assignees_for_multi_assignee`: crea `task_assignees`
  (`task_id` + `profile_id`, PK compuesta, ambos FK on delete cascade) + índice por
  `profile_id`. Backfill: siembra cada `tasks.assignee_id` actual como fila, así el estado
  presente queda reflejado sin perder datos. `tasks.assignee_id` se conserva intacto.

### API (patrón anti-IDOR)
- `src/app/api/tasks/[taskId]/assignees/route.ts`: ruta nueva.
  - GET: lista los asignados (con avatar y nombre).
  - POST `{ profileId }`: agrega; valida que el profile pertenezca al proyecto o workspace;
    si `assignee_id` estaba vacío lo llena (compat).
  - DELETE `?profileId=`: quita; si era el principal, reasigna `assignee_id` a otro
    restante o null.
  - `applyRateLimit` -> auth 401 -> admin -> `checkTaskAccess`. Upsert idempotente.

### UI (iconos lucide, texto en español)
- `src/components/tasks/AssigneesSection.tsx`: componente nuevo, avatares apilados (máx 4 +
  contador) y menú con check por miembro para alternar asignación.
- `src/components/tasks/TaskDetailPanel.tsx`: la fila "Asignado a" pasa a "Asignados" y usa
  `<AssigneesSection>`. Se retira el `AssigneeSelect` de un solo asignado (ya no se usa).
- Los tableros/listas siguen mostrando el asignado principal (`assignee_id` sincronizado);
  la vista apilada vive en el panel para evitar consultas N+1 en las tarjetas.

---

## 2026-07-11: Conversación B, Circuito B3 (dependencias entre tareas)

Tercer circuito de la Conversación B: dependencias estilo ClickUp/Linear. Una tarea
puede quedar "bloqueada por" otras (que deben cerrarse antes) y a la vez "bloquear a"
otras. Se ven como dos listas dentro del panel de la tarea, con un badge ámbar
"bloqueada por N" cuando hay bloqueadores sin cerrar, y al mover la tarea a un estado
de categoría `done` con bloqueadores abiertos aparece un aviso (no bloquea, solo
advierte). Aditivo, no toca Scrum, Marketplace, Chat, Notas ni Pizarra. Deja
`tsc --noEmit` y `next build` en EXIT 0.

### Capa de datos (sin migración)
- Reutiliza la tabla ya presente `task_dependencies` (`task_id` depende de `depends_on`,
  ambos FK a `tasks(id) on delete cascade`, `UNIQUE (task_id, depends_on)`,
  `CHECK (task_id <> depends_on)`). Estaba dormida sin API/UI; ahora se activa. Mismo
  patrón que B1 reusando `labels`/`task_labels`.

### API (patrón anti-IDOR)
- `src/app/api/tasks/[taskId]/dependencies/route.ts`: ruta nueva.
  - GET: devuelve `{ blockers, blocking }` con estado de cada tarea enlazada.
  - POST `{ dependsOnId }`: registra que la tarea depende de otra. Valida mismo proyecto,
    bloquea auto-dependencia y ciclo directo A<->B, upsert idempotente sobre el UNIQUE.
  - DELETE `?dependsOnId=`: quita la dependencia.
  - `applyRateLimit` -> auth 401 -> admin -> `checkTaskAccess`.
- `src/app/api/projects/[projectId]/tasks/search/route.ts`: ruta nueva GET, busca tareas
  del proyecto por título (ILIKE, máx 10) para el picker de dependencias. Authz por
  membresía de proyecto o workspace; escapa `%`/`_`.

### UI (iconos lucide, texto en español)
- `src/components/tasks/DependenciesSection.tsx`: componente nuevo autocontenido por
  taskId. Lista "Bloqueada por" (con quitar) y "Bloquea a", picker con búsqueda por
  título con debounce, badge de bloqueadores abiertos. Reporta el conteo abierto al panel
  vía `onBlockersChange`.
- `src/components/tasks/TaskDetailPanel.tsx`: monta `<DependenciesSection>` bajo Subtareas;
  el selector de estado avisa al mover a `done` con bloqueadores sin cerrar.

---

## 2026-07-11: Conversación B, Circuito B2 (subtareas reales con parent_task_id)

Segundo circuito de la Conversación B: subtareas REALES estilo ClickUp/Linear. A
diferencia del checklist ligero (que se renombró a "Lista de verificación"), cada
subtarea es una tarea completa (estado, prioridad, asignado) enlazada al padre por
`parent_task_id`. Se ven anidadas dentro del panel del padre, con barra de avance
(hechas/total), y se pueden abrir en el mismo panel; el padre muestra una miga de pan
para volver hacia arriba. Aditivo, no toca Scrum, Marketplace, Chat, Notas ni Pizarra.
Deja `tsc --noEmit` y `next build` en EXIT 0.

### Capa de datos (migración aditiva)
- Migración `add_parent_task_id_for_subtasks`: agrega
  `tasks.parent_task_id uuid references tasks(id) on delete cascade` (nullable, default
  null) + índice parcial `idx_tasks_parent_task_id`. Segura: todas las filas existentes
  quedan con parent null, así que el comportamiento actual no cambia.

### API (in-lane, patrón anti-IDOR)
- `src/app/api/tasks/route.ts` (POST): acepta `parent_task_id` opcional. Valida que el
  padre exista y sea del mismo proyecto, y bloquea anidar (una subtarea no puede tener
  hijos): un solo nivel.
- `src/app/api/tasks/[taskId]/subtasks/route.ts`: ruta nueva GET, lista los hijos
  directos (no archivados) con estado y asignado. `applyRateLimit` -> auth 401 -> admin
  -> `checkTaskAccess`. La creación reutiliza POST /api/tasks; el toggle de "hecha"
  reutiliza PATCH /api/tasks/[subtaskId].
- `src/app/api/tasks/[taskId]/route.ts` (GET): ahora trae
  `parent:tasks!tasks_parent_task_id_fkey ( id, title )` para la miga de pan.

### UI (iconos lucide, texto en español)
- `src/components/tasks/SubtasksSection.tsx`: componente nuevo autocontenido por taskId.
  Lista subtareas, crea inline, hace toggle de hecha moviendo el estado a categoría
  done/no-done, borra y navega (`onOpenTask`). Barra de avance por porcentaje.
- `src/components/tasks/TaskDetailPanel.tsx`: monta `<SubtasksSection>` entre Etiquetas y
  la Lista de verificación, agrega miga de pan al padre y el prop opcional `onOpenTask`.
- `src/components/tasks/ChecklistSection.tsx`: encabezado renombrado a "Lista de
  verificación" para no chocar con las subtareas reales.
- `src/components/tasks/KanbanBoard.tsx` y `TaskListView.tsx`: pasan
  `onOpenTask={setSelectedTaskId}` al panel para navegar entre padre e hijas.
- `src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/p/[projectSlug]/page.tsx`: la query de
  nivel superior filtra `.is('parent_task_id', null)` para que las subtareas solo
  aparezcan anidadas y no dupliquen en lista/tablero.

### Verificación
- `npx tsc --noEmit`: EXIT 0. `npx next build`: EXIT 0.
- Deploy prod y commit: ver abajo.

---

## 2026-07-11: Conversación B, Circuito B1 (etiquetas con color en tareas)

Primer circuito de la Conversación B (paridad tipo ClickUp en tareas): etiquetas
(tags) con color por proyecto, adjuntables a cada tarea, con chips visibles en la
lista, el tablero Kanban y el panel de detalle. Cero migración: reutiliza las tablas
`labels` y `task_labels` que ya existían en la DB en vivo pero estaban dormidas (sin
API ni UI). Aditivo, no toca Scrum, Marketplace, Chat, Notas ni Pizarra. Deja
`tsc --noEmit` y `next build` en EXIT 0.

### Capa de datos (sin cambios de esquema)
- Tablas existentes reutilizadas: `labels` (id, project_id, workspace_id, name, color
  default '#6b7280', created_at) y `task_labels` (task_id, label_id, created_at). No se
  aplicó migración porque ya estaban presentes.

### API (in-lane, patrón de checklist-items)
- `src/app/api/tasks/[taskId]/labels/route.ts`: ruta nueva. GET devuelve
  `{ attached, available }` (etiquetas de la tarea + todas las del proyecto). POST
  adjunta: acepta `{ labelId }` (etiqueta existente del proyecto) o `{ name, color }`
  (crea etiqueta nueva del proyecto y la adjunta en un paso), con upsert idempotente en
  `task_labels`. DELETE `?labelId=` la quita. Todo con `applyRateLimit` -> auth 401 ->
  admin client -> `checkTaskAccess` (anti-IDOR, deriva project/workspace en el servidor)
  -> zod. El cliente solo envía el taskId.

### UI (iconos lucide, texto en español)
- `src/components/tasks/TaskLabels.tsx`: componente nuevo. Exporta `LabelChips`
  (presentacional, solo lectura, para filas y tarjetas, con texto legible calculado por
  luminancia) y `TaskLabels` (sección editable en el detalle: adjuntar, quitar y crear
  con paleta de 12 colores). Autocontenido: carga sus datos con el taskId.
- `src/components/tasks/TaskDetailPanel.tsx`: monta `<TaskLabels>` como sección nueva
  arriba de Subtareas.
- `src/components/tasks/TaskRow.tsx` y `KanbanBoard.tsx`: renderizan `LabelChips` en la
  fila (lista) y en la tarjeta (tablero), con el tipo `labels?` aditivo.
- `src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/p/[projectSlug]/page.tsx`: la query de
  tareas ahora trae `labels:task_labels ( label:labels ( id, name, color ) )` y aplana
  la forma anidada antes de pasarla a las vistas.

### Verificación
- `npx tsc --noEmit`: EXIT 0. `npx next build`: EXIT 0.
- Deploy prod y commit: ver abajo.

---

## 2026-07-11: Conversación A, Circuito A5 (presencia en vivo en la nota)

Quinto y último circuito de notas de la Conversación A: mientras varias personas
abren la misma nota, cada una ve un stack de avatares de quién más la está viendo
ahora mismo, con Supabase Realtime Presence. Silencioso si estás solo. Aditivo, no
toca tareas ni los circuitos A2/A3/A4. Deja `tsc --noEmit` y `next build` en EXIT 0.

### UI (cliente, sin capa de datos nueva)
- `src/app/(app)/w/[workspaceSlug]/notes/[noteId]/NotePresence.tsx`: componente
  nuevo. Se suscribe al canal `note-presence-${noteId}` con `presence.key` = id del
  usuario, hace `track()` de su identidad al conectar y en cada `sync` pinta un stack
  de avatares de los OTROS presentes (dedupe por id, excluyendo al usuario actual,
  máx 4 + chip de overflow). Devuelve null si no hay nadie más.
- `src/app/(app)/w/[workspaceSlug]/notes/[noteId]/page.tsx`: carga el perfil propio
  (display_name, avatar_url) y lo pasa a `NoteEditor` como `currentUserName` /
  `currentUserAvatar`.
- `src/app/(app)/w/[workspaceSlug]/notes/[noteId]/NoteEditor.tsx`: acepta las dos
  props nuevas y monta `<NotePresence>` en la barra de acciones, junto al historial.

### Verificación
- `npx tsc --noEmit`: EXIT 0. `npx next build`: EXIT 0.
- Deploy prod y commit: ver abajo.

---

## 2026-07-11: Conversación A, Circuito A4 (historial de versiones de notas)

Cuarto circuito de la Conversación A: cada guardado de contenido crea un snapshot
del estado de la nota, con posibilidad de ver el historial y restaurar una versión
anterior (tipo Notion/Google Docs). Aditivo, no toca tareas ni los circuitos A2/A3.
Deja `tsc --noEmit` y `next build` en EXIT 0. Deploy prod PENDIENTE en esta entrada
(ver commit).

### Capa de datos (migración aditiva, ya aplicada a la DB en vivo)
- `supabase/migrations/20260711020000_note_versions.sql`: tabla nueva `note_versions`
  (id, note_id, workspace_id, title, content, edited_by, created_at, updated_at) con
  índices por note/created_at y workspace, y RLS de SELECT anclada en
  `workspace_members`. La escritura (snapshot/coalesce/restore) la hace solo el
  service_role desde el API.

### API
- `src/lib/note-versions.ts`: `snapshotNoteVersion()` crea o coalesce una versión.
  Para no explotar el historial con el autosave (~1.2s), funde ediciones seguidas del
  MISMO autor dentro de una ventana de 3 min en una sola versión (update en sitio);
  fuera de la ventana o al cambiar de autor, inserta una versión nueva. Dedupe: si el
  content es idéntico a la última versión, no versiona.
- `src/app/api/notes/[noteId]/route.ts`: en PATCH, si cambió `content`, además de
  recalcular backlinks (A3) dispara `snapshotNoteVersion()` (best-effort).
- `src/app/api/notes/[noteId]/versions/route.ts`: GET lista (máx 50, más reciente
  primero) con metadatos y el editor (join a profiles).
- `src/app/api/notes/[noteId]/versions/[versionId]/restore/route.ts`: POST restaura.
  Antes de sobrescribir snapshotea el estado actual (restauración reversible), aplica
  el content/title de la versión a la nota, y recalcula backlinks + historial.

### UI
- `src/app/(app)/w/[workspaceSlug]/notes/[noteId]/NoteVersions.tsx`: botón "Historial"
  en la barra de la nota que abre un panel con los snapshots; cada uno (salvo el
  actual) con acción de restaurar. Al restaurar, recarga la página para que el editor
  tome el contenido restaurado.
- `NoteEditor.tsx`: monta el botón `<NoteVersions>` junto a la acción de sub-página.

---

## 2026-07-11: Conversación A, Circuito A3 (backlinks entre notas)

Tercer circuito de la Conversación A: grafo de documentación tipo Notion/Obsidian.
Cada vez que se guarda el contenido de una nota, se extraen los enlaces internos
a otras notas y se recalcula la tabla de aristas `note_links`. La página de la nota
muestra un panel "Enlazada desde" con las notas que apuntan a ella. Aditivo, no toca
tareas ni el circuito A2. Deja `tsc --noEmit` y `next build` en EXIT 0. Deploy prod
`dpl_5NRL4mynAs75AjPaQtLewXatgds8` (READY).

### Capa de datos (migración aditiva, ya aplicada a la DB en vivo)
- `supabase/migrations/20260711010000_note_links.sql`: tabla nueva `note_links`
  (id, workspace_id, source_note_id, target_note_id, created_at) con unique
  (source, target), check `no_self` (una nota no se enlaza a sí misma), índices por
  target/source/workspace y RLS de SELECT anclada en `workspace_members`. La escritura
  la hace solo el service_role desde el API (recompute-on-save), sin policies de
  insert/delete para usuarios normales.

### API
- `src/lib/note-links.ts`: `extractNoteLinkIds()` parsea los UUID de `/notes/<uuid>`
  del HTML del contenido; `recomputeNoteLinks()` valida que los targets sean notas
  reales del mismo workspace y reescribe las aristas del source (borrar + upsert).
  Best-effort: si falla, no rompe el guardado del contenido.
- `src/app/api/notes/[noteId]/route.ts`: en PATCH, si cambió `content`, dispara
  `recomputeNoteLinks()` (sin bloquear la respuesta).
- `src/app/api/notes/[noteId]/backlinks/route.ts`: GET nuevo. Aristas entrantes
  (target = noteId), con acceso por `workspace_members` + visibilidad y respetando la
  visibilidad de cada nota origen (una privada solo la ve su creador).

### UI
- `src/app/(app)/w/[workspaceSlug]/notes/[noteId]/NoteBacklinks.tsx`: panel
  "Enlazada desde" que consulta el endpoint al montar; silencioso si no hay enlaces.
- `NoteEditor.tsx`: monta `<NoteBacklinks>` antes del hilo de comentarios.

---

## 2026-07-11: Conversación A, Circuito A2 (comentarios dentro de la nota + menciones al inbox)

Segundo circuito de la Conversación A: hilo lateral de comentarios en cada nota,
reutilizando el patrón de comentarios de tareas, con @menciones que notifican al
inbox del mencionado y llegada en vivo por Realtime. Aditivo, no toca tareas ni
ninguna tabla existente. Deja `tsc --noEmit` y `next build` en EXIT 0. Deploy prod
`dpl_G1PaRLMRF2da2JoRCN7koVBbNzYQ` (READY).

### Capa de datos (migración aditiva, ya aplicada a la DB en vivo)
- `supabase/migrations/20260711000000_note_comments.sql`: tablas nuevas
  `note_comments` (id, note_id, workspace_id, author_id, content, timestamps) y
  `note_mentions` (id, note_id, mentioned_id, mentioned_by, source, created_at),
  ambas con RLS ancladas en `workspace_members` + org owner/admin (las notas son
  de alcance workspace, no de proyecto). Índices por note/workspace/mencionado,
  trigger `updated_at`, y alta best-effort de `note_comments` a la publicación
  `supabase_realtime`.

### API (espejo del patrón de tareas, acceso por workspace + visibilidad)
- `src/app/api/notes/[noteId]/comments/route.ts`: GET lista + POST agrega. Acceso
  vía nota + `workspace_members` + visibilidad (private = solo su creador). Mapea
  `content` a `body` para la UI. POST rate-limited, zod `.strict()`, registra
  `logActivity(NOTE_COMMENTED)`.
- `src/app/api/notes/[noteId]/mentions/route.ts`: GET mencionables (miembros del
  workspace) / POST filtra a miembros reales server-side (nunca confía en el
  cliente), inserta `note_mentions`, crea `createNotification(NOTE_MENTIONED,
  object_type:'note')` por destinatario y `logActivity(NOTE_MENTIONED)`.
- `src/lib/activity.ts`: verbos `NOTE_COMMENTED`, `NOTE_MENTIONED` y tipo de
  notificación `NOTE_MENTIONED = 'note_mentioned'`.

### UI
- `src/app/(app)/w/[workspaceSlug]/notes/[noteId]/NoteComments.tsx`: componente
  nuevo con lista de comentarios, composer con autocompletar de @menciones
  (iconos lucide, español con ñ/tildes, sin guiones largos) y suscripción
  Realtime a `note_comments` (resuelve el autor con la lista de miembros ya
  cargada, ya que el payload trae la fila cruda). Se monta al final de
  `NoteEditor.tsx`.
- `src/app/(app)/w/[workspaceSlug]/inbox/InboxList.tsx`: etiquetas para
  `note_mentioned`/`task_mentioned` y navegación al hacer click en una
  notificación de nota (`/w/{slug}/notes/{object_id}`).

---

## 2026-07-11: Conversación A, Circuito A1 (guardado robusto de Notas, antipérdida)

Inicio de la Conversación A del roadmap a paridad ClickUp (`docs/ROADMAP-CLICKUP-PARITY.md`):
robustez del editor y guardado de Notas con estado visible. Aditivo, no toca el
guardado de descripciones de tareas (que sigue siendo solo al blur). Deja
`tsc --noEmit` y `next build` en EXIT 0. Deploy prod
`dpl_FCFUTojbs78NqeU6sbT8qp1BLR6Q` (READY).

### Causa raíz que se corrige
- El `RichTextEditor` solo persistía el contenido en `onBlur`. Si el usuario
  escribía y navegaba o cerraba la pestaña sin quitar el foco del editor, se
  perdía lo escrito. Esa era la razón de fondo de "las notas no funcionan bien".

### Cambios
- `src/components/editor/RichTextEditor.tsx`: props opcionales nuevas
  `autosaveMs?: number` (default 0) y `onDirty?: () => void`. Con `autosaveMs>0`
  se agrega autosave con debounce mientras se escribe (via `onUpdate`), además del
  guardado al blur. Refs `onSaveRef`/`onDirtyRef` para no capturar closures viejas,
  timer con limpieza al desmontar. Sin la prop, el comportamiento es idéntico al
  anterior (solo blur), por eso las descripciones de tareas no cambian.
- `src/app/(app)/w/[workspaceSlug]/notes/[noteId]/NoteEditor.tsx`: máquina de
  estado de guardado `saved | dirty | saving | error` con indicador visible
  (iconos lucide: Check, Loader2, AlertTriangle, RotateCw). Reintento con el
  último payload que falló (guardado en ref). Guardia `beforeunload` cuando hay
  cambios sin guardar / en vuelo / con error. Pasa `autosaveMs={1200}` y `onDirty`
  al editor; el título también marca "sin guardar" durante su debounce.

---

## 2026-07-11: Circuitos 1 a 3 (arreglo de Notas + chat robusto con historial + burbuja flotante)

Loop de robustecimiento pedido por Ali: "que sea un sistema de verdad eficiente",
chat robusto con historial revisable y burbuja flotante. Tres circuitos aditivos,
cada uno deja `tsc --noEmit` y `next build` en EXIT 0. Deploy prod
`dpl_4zcSZXe6Siq8y5TjdyjkWAREb3a9` (READY).

### Circuito 1: Notas volvieron a funcionar (bug crítico auto-introducido)
- Causa raíz: la migración previa de iconos de Notas de emoji a claves lucide
  produjo claves de más de 8 caracteres (`clipboard`=9, `lightbulb`=9,
  `graduation`=10) pero los schemas zod de la API seguían con `icon` a `max(8)`,
  así que crear/editar nota con esas plantillas devolvía 422 "Datos inválidos".
- Fix: subí `icon` a `z.string().max(64)` en `api/notes/route.ts` (POST) y en
  `api/notes/[noteId]/route.ts` (PATCH). Sin migración de DB.

### Circuito 2: chat robusto con historial paginado
- Nuevo `GET /api/messages?team_id&before&limit` con paginación por cursor
  (orden ascendente, `hasMore` para saber si queda historia detrás). Autoriza por
  membresía de equipo (401 -> admin -> 403). Trae `limit+1` para detectar más.
  En la primera página (sin cursor) devuelve también `members` para resolver el
  autor en el widget flotante. Egress cuidado: miembros solo en la primera página.
- `TeamChat.tsx`: botón "Cargar mensajes anteriores" arriba del hilo. Prepende
  la historia sin saltar al fondo (preserva la posición de lectura con
  `scrollHeight` antes/después y un `requestAnimationFrame`). Dedupe por id.

### Circuito 3: burbuja de chat flotante global
- Nuevo `components/chat/FloatingChat.tsx`, montado en el layout del workspace
  (`w/[workspaceSlug]/layout.tsx`), accesible desde CUALQUIER página. Burbuja
  fija abajo a la derecha; al abrir muestra un panel con selector de equipo
  (si hay más de uno), carga mensajes + miembros bajo demanda via el nuevo GET
  y cachea por equipo mientras el panel viva. Reutiliza `TeamChat` para el hilo
  en vivo y el historial. Indicador de no leídos: escucha INSERT realtime de los
  equipos del usuario mientras el panel está cerrado, ignora mensajes propios.
  Link a pantalla completa (`/t/[slug]/chat`). Iconos lucide (MessageSquare, X,
  Maximize2, ChevronDown), sin emojis.

### Verificación
- `npx tsc --noEmit` EXIT 0. `npx next build` EXIT 0. Deploy prod READY.

---

## 2026-07-11: Bloques B y C del loop (chat de equipo + barrido de guiones + iconos de Notas)

Continuación del loop de mejora. Este pase junta el trabajo pendiente medido en
el bloque A: chat general por equipo visible en el panel del equipo, barrido
mecánico de guiones largos en todo `src`, y la migración del sistema de iconos
de Notas de emojis a registry lucide con fallback legacy (sin migración de DB).
Todo aditivo: no rompe Scrum, Marketplace ni Chat.

### Chat general por equipo en el panel del equipo
- La página del equipo (`w/[workspaceSlug]/t/[teamSlug]/page.tsx`) monta el
  `<TeamChat>` en un `<aside>` a la derecha del panel, de modo que el chat del
  equipo se ve directo en la vista principal (el "panel general" del equipo).
  Usa las tablas Realtime existentes (`messages`), sin esquema nuevo.

### Capa de colaboración (bloque B) verificada
- Rutas API de mensajes, comentarios, adjuntos, menciones y mensajes de proyecto
  (`api/messages`, `api/tasks/[taskId]/comments`, `.../attachments`,
  `.../mentions`, `api/projects/[projectId]/messages`) revisadas: ya cumplen el
  patrón auth 401 -> admin client -> membresía 403 -> columnas explícitas + zod
  + rate limit + IDs desde params (anti-IDOR). Sin cambios (evitar churn).

### Barrido de guiones largos en `src`
- Reemplazo mecánico de em/en dash por coma, dos puntos, paréntesis o `·` en los
  archivos restantes (mayoría comentarios docstring, no visibles). Regla F025.

### Iconos de Notas: emoji a registry lucide (sin migración de DB)
- Nuevo `lib/note-icons.tsx`: registry `NOTE_ICONS` (15 iconos lucide con clave
  estable), `DEFAULT_NOTE_ICON = 'file'`, componente `<NoteIcon />`, y
  `LEGACY_EMOJI_MAP` + `normalizeNoteIconKey()` que convierten los emojis viejos
  guardados en DB a la clave lucide equivalente al renderizar. Las notas y
  plantillas nuevas guardan la clave; las viejas siguen viéndose bien. Cero
  riesgo de datos, sin tocar Supabase.
- `lib/note-templates.ts`: los 6 `icon` de plantillas pasan de emoji a clave
  (`file`, `clipboard`, `calendar`, `target`, `scale`, `books`).
- `NoteEditor.tsx`, `NotesActionsBar.tsx`, `NotesTreeSidebar.tsx`,
  `notes/page.tsx`: render de icono migrado a `<NoteIcon />`; el picker mapea
  `NOTE_ICONS`; el estado inicial usa `normalizeNoteIconKey(initial.icon)`.

### Verificación
- `npx tsc --noEmit` = EXIT 0. `npx next build` = EXIT 0 (todas las rutas
  compilan). Los únicos glifos emoji restantes son las claves intencionales del
  `LEGACY_EMOJI_MAP` (no se renderizan como UI).
- Sin migración de DB. Sin deploy (lo coordina el deployer).

---

## 2026-07-11: Bloque A del loop de mejora (purga de emojis + guiones en UI)

Loop de mejora system-wide dividido en 3 conversaciones (A/B/C). Este es el
bloque A: cumplir las reglas duras del proyecto (sin emojis decorativos en UI,
sin guiones largos en texto visible) en superficies que las violaban, con
cambios aditivos que no rompen Scrum, Marketplace ni Chat.

### Emojis decorativos reemplazados por iconos lucide
- `tasks/TaskRow.tsx`: mapa de prioridades pasa de emojis/flechas de texto
  (con un em dash en el label "none") a iconos lucide con color semántico
  (`ChevronsUp`/`ChevronUp`/`Equal`/`ChevronDown`/`Minus`). Aplica en los dos
  sitios de render (botón inline y `PriorityMenu`).
- `chat/TeamChat.tsx`: estado vacío usa `<MessageSquare />` en vez de 💬.
- `auth/unauthorized/page.tsx`: usa `<ShieldX />` en vez de ✕.
- `settings/invites/InvitesPanel.tsx`: badge de invite con contraseña usa
  `<Lock />` en vez de 🔒.

### Guiones largos visibles al usuario
- `lib/note-templates.ts`: 9 em dashes que renderizaban como contenido/títulos
  de plantillas se reemplazan por dos puntos o `·` ("SOP: Procedimiento",
  "Paso 1: describir...", "Reunión: [Tema]", "[Tarea] · [responsable] · [fecha]",
  "Brief: [Nombre del proyecto]", "Decisión: [Tema]"). Los iconos emoji de las
  plantillas se dejan para el bloque C (requieren migración de datos como la de
  project-icons).

### Verificación
- `npx tsc --noEmit` = EXIT 0.
- Sin cambios de datos ni migración. Sin deploy (lo coordina el deployer).

### Pendiente medido para B/C
- 144 ocurrencias de em/en dash en 88 archivos (mayoría comentarios docstring,
  no visibles) para barrido mecánico.
- Sistema de iconos emoji de Notas (`note-templates.ts`, `NotesTreeSidebar.tsx`,
  `NoteEditor.tsx` picker, `notes/page.tsx`) guarda un emoji `icon` por nota en
  DB: migrar a registry lucide + fallback legacy.

---

## 2026-07-05: Planeación del equipo (renombre + puente de contexto)

Auditoría: el equipo tiene un tablero (Scrum/Kanban) y cada proyecto tiene otro
tablero (vista Tablero/Kanban). Ambos se llamaban "Tablero", lo que se leía
redundante. El modelo de datos es coherente (estilo Linear: metodología y
sprints viven a nivel EQUIPO, agregando tareas de todos sus proyectos), pero la
UI reflejaba dos altitudes con el mismo nombre y el mismo lenguaje visual. Se
arregla como problema de PRESENTACIÓN, sin tocar datos ni migración.

### Opción 1: "Tablero" del equipo pasa a "Planeación"
Para que "Tablero" deje de significar dos cosas, los puntos de entrada al
tablero del equipo (`/scrum`) se renombran; la vista Tablero del proyecto queda
igual.
- `sidebar/NavSection.tsx`: enlace del equipo "Tablero" -> "Planeación".
- `t/[teamSlug]/page.tsx`: botón primario "Ir al Tablero" -> "Ir a Planeación".
- `p/[projectSlug]/page.tsx`: botón "Tablero del equipo" -> "Planeación del
  equipo" (label + `title`).

### Opción 2: puente de contexto cuando el equipo tiene 1 solo proyecto
Con un único proyecto, Planeación y el tablero del proyecto se ven casi iguales.
No se oculta la Planeación (los sprints/flujo siguen aportando valor), pero se
añade una nota que aclara la diferencia y enlaza al proyecto.
- `t/[teamSlug]/scrum/page.tsx`: la consulta de proyectos ahora trae `slug`;
  arma `soloProject = { name, href }` cuando hay exactamente 1 proyecto y lo pasa
  a `ScrumWorkspace`.
- `ScrumWorkspace.tsx`: nueva prop opcional `soloProject`, propagada a
  `BoardView`. Bajo el banner de modo, si `!multiProject && soloProject`, muestra
  una línea: "Planeación del equipo: organiza el trabajo en sprints (o gestiona
  el flujo continuo). El detalle por estados vive en el tablero del proyecto." +
  enlace al proyecto (icono `ArrowUpRight`).

### Deploy
`wlo-l8x6eo2co` (Ready). tsc limpio, `next build` OK.

---

## 2026-07-05: Iconos de proyecto sin emojis (lucide)

El selector "Icono" al crear proyecto usaba emojis (rechazados por regla del
proyecto). Migrado a iconos lucide con un registro compartido para que TODAS las
superficies rendericen igual y los proyectos viejos con emoji guardado caigan a
un icono limpio (`Hash`).

### Nuevo `src/lib/project-icons.tsx`
- `PROJECT_ICONS`: 12 iconos lucide con clave estable + etiqueta en español
  (clipboard, rocket, lightbulb, target, wrench, chart, palette, flask, phone,
  globe, zap, building).
- `DEFAULT_PROJECT_ICON = 'clipboard'`.
- `<ProjectIcon icon={clave} size className />`: render por clave, cae a `Hash`
  para claves desconocidas o emojis heredados (así los proyectos viejos ya no
  muestran emoji).

### Cambios
- `NewProjectForm.tsx`: el picker ahora pinta iconos lucide y guarda la CLAVE;
  default `clipboard`; `title`/`aria-label`/`aria-pressed` por accesibilidad.
- `api/projects/route.ts` y `api/projects/[projectId]/route.ts`: `icon` zod
  `max(4)` -> `max(24)` (las claves son mas largas que un emoji); default de
  creacion `'clipboard'` en vez de emoji. Columna `icon` es `text`, sin cambio
  de esquema.
- Render migrado a `<ProjectIcon />` en: `sidebar/NavSection.tsx`,
  `t/[teamSlug]/page.tsx`, `t/[teamSlug]/p/[projectSlug]/page.tsx`,
  `command-palette/CommandPalette.tsx` (se quito el `sublabel` que mostraba el
  emoji). Imports `Hash` sueltos removidos donde ya no se usan.
- Marketplace/ManageProject/CV cargan `icon` en data pero no lo renderizan: sin
  cambios ahi. Los iconos de NOTAS son otra feature, fuera de alcance.

Aditivo, sin migracion. `npx tsc --noEmit` EXIT 0, `npx next build` EXIT 0.

---

## 2026-07-04 (P0): Visibilidad de proyecto en el Tablero del equipo

El Tablero (Scrum/Kanban) es de EQUIPO y junta tareas de TODOS los proyectos del
equipo, pero no se veía a qué proyecto pertenecía cada tarjeta. P0 lo resuelve
100% en el cliente: el server ya envía `project_id` y `project_name` por tarea,
así que cero migración, cero API nueva, todo ADITIVO. Sin emojis (iconos lucide),
sin guiones largos, ñ/tildes correctas. `npx tsc --noEmit` EXIT 0 y
`npx next build` EXIT 0 (gate ESLint).

### Cambios (`src/components/scrum/ScrumWorkspace.tsx`, único archivo)
- Chip de proyecto en cada tarjeta: cuadrito de color + nombre del proyecto.
  Solo aparece si el equipo tiene mas de un proyecto (`multiProject`) y cuando no
  se está agrupando ya por proyecto (evita ruido redundante).
- Paleta estable `PROJECT_COLORS` (10 colores) asignada por índice al set de
  proyectos ordenado por nombre, vía memo `projectColor` (mismo color siempre
  para el mismo proyecto en toda la vista: chip, carril, pill de filtro).
- Nuevo agrupar en carriles por Proyecto (`groupBy === 'project'`): botón en el
  segmento de agrupación (icono `Layers`), solo visible con `multiProject`. El
  encabezado del carril muestra el cuadrito de color del proyecto.
- Filtro por proyecto: pills con color, multi-selección (`pickProject` Set),
  junto a los filtros de persona/Vencidas/Sin asignar. "Limpiar" ahora también
  resetea `pickProject`.
- El filtro por proyecto entra en el memo `visible` y en el booleano
  `filtering`; se respeta drag-and-drop, presencia, orden y demás estado cliente.

Deploy: pendiente en esta entrada (se despliega junto con este commit).

---

## 2026-07-04 (R2): Conv C - Jerarquía proyectos/equipos + tableros visibles

Sin deploy (avisa al deployer). Todo ADITIVO, sin migraciones. Solo mis 5
archivos dueños; no toqué Sidebar, ScrumWorkspace, MiDia (de B) ni ProjectsBoard
(cliente no propiedad: se envolvió, no se editó). Sin emojis (iconos lucide),
sin guiones largos, ñ/tildes correctas. `npx tsc --noEmit` EXIT 0 (árbol
completo, ya sin el error `Timer` que reportó Conv B).

### C1 - Team page lidera con el Tablero (`t/[teamSlug]/page.tsx`)
- Botón PRIMARIO "Ir al Tablero" (`LayoutDashboard`) a `/t/[teamSlug]/scrum` en
  el header; "Nuevo proyecto" degradado a secundario (borde) con `Plus`.
- Breadcrumb claro Workspace / Equipo.
- Arreglado el emoji fallback (antes `{project.icon ?? '📋'}`): ahora icono
  lucide `Hash` cuando el proyecto no tiene icono.
- Tarjetas de proyecto muestran el "trabajo real": conteo de tareas activas por
  proyecto (`ListChecks` + `n tareas`), query barata `tasks` filtrada por
  `project_id in (...)` y `is_archived=false`, reducida a un Map en el server.

### C2 - Marketplace vs workspace claros
- `projects/page.tsx`: banner "Oportunidades internas: postúlate a proyectos
  abiertos" (`Compass`) que diferencia el marketplace del trabajo diario. Se
  añadió envolviendo `<ProjectsBoard/>` (no se editó el componente cliente).
- `projects/[projectId]/page.tsx`: back-link renombrado a "Oportunidades"
  (alineado con Conv A) + CTA "Ir al espacio del proyecto" (`LayoutDashboard`)
  a `/w/{ws}/t/{team}/p/{proj}`, solo visible si el proyecto ya tiene equipo y
  slug (select extendido con `slug, team:teams(slug)`).

### C3 - Project workspace enlaza al Tablero del equipo
- `t/[teamSlug]/p/[projectSlug]/page.tsx`: link "Tablero del equipo"
  (`LayoutDashboard`) a `/t/[teamSlug]/scrum` en el header, junto al switcher de
  vistas. Además, mismo fix de icono `Hash` en el título cuando no hay `icon`.

### C4 - Home: acceso directo a tableros de equipos
- `w/[workspaceSlug]/page.tsx`: cada tarjeta de equipo pasó de `<Link>` único a
  `<div>` con dos enlaces hermanos (evita anidar Links): título -> página del
  equipo, y botón "Tablero" (`LayoutDashboard`) -> `/t/[slug]/scrum`. MiDia se
  renderiza igual (archivo de B, no modificado).

---

## 2026-07-04 (R2): Conv B - Calendario sin ruido + actividades WLO

Sin deploy (regla de oro: avisa al deployer). Todo ADITIVO, sin migraciones.
Seguridad estándar en la API: `applyRateLimit`, `createClient` auth (401),
`createAdminClient`, zod `.strict()`. Archivos dueños de Conv B; no se tocaron
archivos de A ni C.

Estado `npx tsc --noEmit`: mis 4 archivos compilan limpios. El único error del
árbol está en `t/[teamSlug]/page.tsx` (Conv C): usa `Timer` (línea 125) sin
importarlo de `lucide-react`; fuera de mi propiedad, no lo toco. Ver aviso al
deployer.

### B1 - Nuevo endpoint `GET /api/activities?from=&to=`
- `src/app/api/activities/route.ts`: devuelve actividades WLO del usuario en el
  rango, normalizadas. Fuentes: (1) tareas asignadas (`assignee_id = user.id`,
  `is_archived=false`, `due_date` en rango) y (2) fin de sprints de sus equipos
  (`sprints.end_date` en rango). Salida `{ id, type:'task'|'sprint', title, date,
  priority, project_name, href }`.
- Anti-IDOR: re-check de membresía vía `team_members` -> equipos del usuario;
  las tareas se filtran además a proyectos de esos equipos (nunca se exponen
  datos de equipos donde el user no es miembro). `href` a la página del proyecto
  (`/w/{ws}/t/{team}/p/{proj}`) o del equipo (sprints).
- zod `.strict()` para `from`/`to` (datetime opcional; default hoy -1d a +60d).
  Los sprints (columna `date`) se comparan por fecha calendario.

### B2 - MiDia: WLO primero, Google atenuado (`MiDia.tsx`)
- Dos fuentes independientes: `/api/activities` (HOY) arriba como "Tareas de hoy"
  con acento primario e iconos lucide (`CheckSquare` tareas, `Timer` fin de
  sprint, punto de color por prioridad); Google debajo como "Agenda externa" en
  tono atenuado.
- Ya no queda vacío/CTA-only sin Google: si no hay conexión, MiDia sigue útil con
  las actividades WLO y ofrece un CTA discreto para conectar Google.

### B3 - CalendarView: fusión de fuentes + filtros de ruido (`CalendarView.tsx`)
- Merge de eventos Google + actividades WLO diferenciados por color/badge (WLO
  tarea = primario, WLO sprint = violeta, Google = muted). La vista ya NO se
  bloquea si Google no está conectado: muestra WLO + CTA discreto.
- Filtros de cliente (toggles): "Actividades WLO", "Eventos Google", "Ocultar
  todo el día" y buscador por título. Persistidos en localStorage
  `wlo-calendar-filters`. Default: WLO ON, Google ON, ocultar todo el día OFF.

### B4 - `api/calendar/events`: filtro server-side opcional (aditivo)
- `route.ts` acepta `q` (búsqueda por summary) y `hideAllDay` (`'true'|'false'`)
  además de `from`/`to`, en el mismo zod `.strict()`. Retrocompatible (sin params
  = comportamiento actual). El filtrado fuerte vive en el cliente (B3); esto es
  refuerzo.

## 2026-07-04 (R2): Conv A - Navegacion jerarquica + tablero visible

Sin deploy (lo hace el deployer al final de la ronda 2). Todo ADITIVO, solo UI.
`npx tsc --noEmit` EXIT=0. Sin migraciones. Dueno exclusivo: `Sidebar.tsx`,
`NavSection.tsx`, `WorkspaceSwitcher.tsx`.

- A1: item de sidebar `Proyectos abiertos` renombrado a `Oportunidades` (deja claro
  que es el marketplace de postulaciones, no el workspace de trabajo). Ruta
  `/w/[slug]/projects` e icono `Compass` intactos.
- A2: en cada equipo (NavSection) el link `Scrum` se renombra a `Tablero` (neutral,
  cubre Scrum y Kanban); mismo `BoardIcon` y ruta `/t/[slug]/scrum`. Cuando el
  equipo esta en foco pero ningun hijo activo, `Tablero` se resalta como accion
  sugerida (`ring-primary/40 bg-primary/5`) para que no quede escondido.
- A3: contenedor de hijos del equipo con linea guia izquierda (`border-l pl-1.5`)
  para leer Tablero/Chat/proyectos como jerarquia del equipo (estilo Linear).
- A4: verificado sin emojis en los 3 archivos (iconos lucide/SVG).

---

## 2026-07-04: Conv C — Time tracking + Scores/CV premium + Purga de emojis

Sin deploy (regla de oro: avisa al deployer). Todo ADITIVO. `npx tsc --noEmit`
EXIT=0. Seguridad en cada API: auth 401, admin client con rechequeo de membresía en
el handler (anti-IDOR), zod `.strict()`, `applyRateLimit`. Tablas nuevas vía
`(admin as any)`; no se editó `src/lib/supabase/types.ts` a mano.

### T1 — Time tracking (cronómetro por tarea + timesheet)
- Migración `create_time_entries` aplicada por Supabase MCP (proyecto
  `cmskiyypeujcgikbvyoz`): tabla `time_entries` (`task_id`→tasks CASCADE,
  `project_id`/`workspace_id`/`profile_id` NOT NULL, `started_at`, `ended_at` null =
  corriendo, `duration_sec`, `note`). RLS: SELECT dueño o manager del proyecto;
  INSERT/UPDATE/DELETE solo dueño (`profile_id = auth.uid()`). Índice único parcial
  `te_one_running (profile_id) WHERE ended_at IS NULL` garantiza un solo timer activo
  por persona (su violación devuelve 409).
- APIs `src/app/api/time-entries/**`: `_access.ts` (helper `resolveTaskAccess`
  resuelve project_id/workspace_id desde la tarea server-side, nunca del body, y
  valida `project_members`); `start` (POST `{task_id}`, 409 si ya hay uno);
  `stop` (POST cierra el corriendo, calcula `duration_sec`); `route.ts` (GET
  `?from=&to=&project_id=` con joins task+project, y POST manual
  `{task_id, started_at, ended_at, note?}` validando ended>started);
  `[entryId]` (PATCH/DELETE solo del dueño, recalcula duración).
- `src/components/tracking/TaskTimer.tsx`: botón Play/Square (lucide) + cronómetro
  vivo (`formatClock`), montado en cada fila de `my-tasks`.
- `src/app/(app)/w/[slug]/tracking/**` (`page.tsx` + `TrackingClient.tsx`): timesheet
  Hoy/Semana, totales por proyecto y por día, gráfico `recharts` de horas por día,
  entradas editables inline (PATCH/DELETE), alta manual. Bucketing en hora local del
  navegador (semana desde lunes) para no depender de la tz del server.

### T2 — Scores/CV premium (`cv/[profileId]/page.tsx`)
- Reescrito `ReputationPanel`: tarjeta de score global (promedio de los 4 ejes,
  número 4xl + 5 estrellas + badge de nivel con icono `Award`), barras por eje
  (`AxisBar`), conteo de reviews. Helper `levelFor` (Excepcional/Sólido/En
  desarrollo/Necesita apoyo). **k-anonimato intacto**: promedios solo con >=3 reviews;
  debajo del umbral, mensaje con conteo "{n} de 3". No se tocó el contrato de
  `project_reviews` ni de `profile_reputation()`. Iconos lucide, sin emojis. Acentos
  corregidos en CvProjects.tsx (Líder, calificación, anónima, Colaboración, etc.).

### T3 — Purga de emojis (decorativos → lucide)
- `inbox/InboxList.tsx` (✓ → `Check`), `t/[teamSlug]/page.tsx` (🏃 → `Timer`,
  📋 vacío → `FolderKanban`), `notes/[noteId]/NoteEditor.tsx` (etiquetas de
  visibilidad 🌐👥📁🔒 → `Globe/Users/Folder/Lock`, chevron), `components/notes/
  NotesTreeSidebar.tsx` (menú contextual ✏️➕📑⭐☆🗑️ → `Pencil/Plus/Copy/Star/Trash2`,
  `ContextItem.icon` ahora `ReactNode`).
- **Se dejó a propósito** el emoji de los selectores de icono de nota/proyecto
  (`ICON_OPTIONS`, `QUICK_ICONS` y los fallbacks `icon ?? '📄'`/`'📋'`): son DATO de
  contenido guardado en BD (`note.icon`/`project.icon`), sistema compartido con el
  render de proyectos (fuera del carril de Conv C). Convertir solo el picker crearía
  inconsistencia. `TimerWidget` opcional NO se creó: su montaje global exige
  `w/[slug]/layout.tsx` (prohibido, de Conv A); código muerto sin montar sería peor.

---

## 2026-07-04: Conv B — Chat por proyecto + Modal de tarea (adjuntos + menciones)

Sin deploy (regla de oro: avisa al deployer). Todo ADITIVO. `npx tsc --noEmit`
EXIT=0. Seguridad en cada API: auth 401, admin client, rechequeo de membresía en
el handler (anti-IDOR), zod `.strict()`, `applyRateLimit`. Se usa `(admin as any)`
para las tablas nuevas; no se editó `src/lib/supabase/types.ts` a mano.

### T1 — Chat por proyecto (realtime)
- Migración `conv_b_project_messages` aplicada por Supabase MCP: tabla
  `project_messages` (`project_id`, `workspace_id`, `author_id`, `body`, `created_at`).
  RLS con policy SELECT para miembros del proyecto o de su workspace; tabla añadida a
  la publicación `supabase_realtime` para que los clientes autenticados reciban los
  INSERT en vivo. Escritura solo por service_role (server).
- `src/components/chat/ProjectChat.tsx`: clon de TeamChat. Canal
  `project-chat-${projectId}` filtrado por `project_id`; upsert optimista con dedupe
  por id; estado vacío con icono lucide `MessagesSquare` (sin emoji); `formatTime` es-MX.
- `api/projects/[projectId]/messages` (GET últimos 100 + POST enviar). Helper
  `canAccessProject` (project_members, luego workspace_members). `workspace_id` se
  resuelve del proyecto, nunca del body. zod `{body: string.min(1).max(4000).trim()}`.
- Montado en 2 superficies: pestaña "Chat" en la página de proyecto
  (`w/[slug]/t/[teamSlug]/p/[projectSlug]/page.tsx`, tercer `ViewToggle` con icono) y
  una sección de chat en `w/[slug]/projects/[projectId]/page.tsx` (ManageProject).

### T2 — Modal de tarea rediseñado (`TaskDetailPanel.tsx`)
- Panel más ancho (`max-w-3xl`), cuerpo en dos columnas (contenido + `aside` de
  metadatos). Prioridades con iconos lucide (Zap/ChevronsUp/ChevronUp/ChevronDown/
  Minus), sin emojis ni flechas de texto. Header con pill de estado, chip de
  prioridad, indicador Guardando (Loader2) y botones Trash2/X.

### T3 — Adjuntos
- Migración `conv_b_task_attachments` + bucket privado `task-files`
  (`conv_b_task_files_bucket`, public=false). Acceso 100% server-side via
  service_role; se sirve con signed URL temporal (TTL 1h).
- `api/tasks/[taskId]/attachments` (GET lista con signed URL + POST multipart,
  campo `file`). Validación server: tamaño <= 25MB, allowlist de mime, path scoped
  `task/{taskId}/{uuid}-{safeName}`. La columna `url` guarda el PATH del objeto.
  Rollback del objeto si el insert falla.
- `api/tasks/[taskId]/attachments/[attachmentId]` (DELETE): solo quien lo subió o
  un manager (rol manager / lead del proyecto / org owner-admin). Anti-IDOR: el
  adjunto debe pertenecer al `taskId` de la ruta.
- `AttachmentsSection` en el modal: zona drag-drop + input oculto, previsualización
  de imágenes (signed URL), enlace de descarga, borrar (visible al autor).

### T4 — Menciones (@)
- Migración `conv_b_task_mentions`: tabla `task_mentions` (`task_id`,
  `mentioned_id`, `mentioned_by`, `source`).
- `api/tasks/[taskId]/mentions` (GET miembros mencionables + POST registrar).
  zod `{mentioned_ids: uuid[].min(1).max(20), source: 'comment'|'description'}`. Se
  filtra a miembros REALES del proyecto (nunca se confía en el cliente) y se excluye
  la auto-mención. Cada mención crea una notificación `TASK_MENTIONED` al mencionado
  (Bandeja) + registra actividad.
- `CommentComposer` con autocompletado @ (dropdown de miembros); las menciones se
  revalidan server-side tras publicar comentario y tras guardar descripción.

### Tipos nuevos en `src/lib/activity.ts` (soy dueño único)
- `ActivityVerbs.TASK_MENTIONED = 'task.mentioned'`.
- `NotificationTypes.TASK_MENTIONED = 'task_mentioned'`.

## 2026-07-04: Conv A — Shell + Navegación + Google Calendar

Sin deploy (regla de oro: avisa al deployer). Todo ADITIVO. Archivos dueños de
Conv A (`src/components/sidebar/**`, `w/[slug]/page.tsx`, nuevos `w/[slug]/calendar/**`,
`api/calendar/**`, `api/google/connect|callback/**`); no se tocaron archivos de B ni C.
`npx tsc --noEmit` reporta 0 errores en archivos de Conv A; los 2 únicos errores
del árbol están en `my-tasks/page.tsx` (Conv C, `FilterLink label` recibe JSX
donde el tipo pide `string`), fuera de mi propiedad.

### T1 — Sidebar jerarquizado (patrón Linear/Height)
- Reescrito `src/components/sidebar/Sidebar.tsx`: nav plano agrupado en 3 secciones
  colapsables ("Principal", "Espacio", "Equipos") con encabezados tenues. Estado de
  grupos persistido en `localStorage` (`wlo-sidebar-groups`) vía `toggleGroup`.
- Migrado a iconos `lucide-react` (Home, CheckSquare, Inbox, CalendarDays, Timer,
  FileText, PenTool, Compass, IdCard, Search, ChevronLeft, ChevronDown, Plus); se
  eliminaron los SVG inline. Nuevo subcomponente `NavGroup`.
- Modo colapsado `w-14` con tooltips intacto. Enlaces nuevos: Calendario
  (`${base}/calendar`) y Tracking (`${base}/tracking`).
- `src/components/sidebar/NavSection.tsx`: reemplazado el emoji de fallback por
  icono `Hash` de lucide (respeta el `project.icon` que ya haya puesto el usuario).

### T2 — Home más claro (`w/[slug]/page.tsx`)
- Fila de acciones rápidas (Mis tareas, Calendario, Proyectos, Notas) con iconos
  lucide. Prioridad de tareas ahora es un punto de color (sin emojis).
- Nuevo bloque "Mi día" (`MiDia.tsx`): agenda de HOY desde Google Calendar si hay
  conexión, si no un CTA "Conectar Google Calendar". No duplica lógica de my-tasks.

### T3 — Google Calendar (OAuth incremental, server-only)
- Migración `conv_a_google_connections` aplicada por Supabase MCP: tabla
  `google_connections` (tokens nunca al cliente), RLS `gc_own` (`profile_id = auth.uid()`).
- `src/lib/google/client.ts`: helper OAuth (scope `calendar.readonly`, redirect uri).
- `api/google/connect` (CSRF state en cookie httpOnly, `access_type:offline`,
  `prompt:consent`) + `api/google/callback` (intercambia code, preserva refresh_token,
  upsert por `profile_id`).
- `GET /api/calendar/events?from=&to=` (zod strict, refresca token si expiró,
  `events.list` de `primary`, normaliza `{id,title,start,end,allDay,htmlLink}`; 409
  `not_connected`/`reconnect` para que el front muestre CTA).
- Página `/w/[slug]/calendar` + `CalendarView.tsx`: cuadrícula mensual propia
  (date-fns, locale es) con estado vacío/CTA de conexión.

### Config pendiente para el deployer
- En Google Cloud Console: registrar redirect URI
  `${NEXT_PUBLIC_APP_URL}/api/google/callback` y añadir el scope `calendar.readonly`
  a la pantalla de consentimiento OAuth. Variables: `GOOGLE_CLIENT_ID`,
  `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_APP_URL`.

## 2026-07-04: Conv C — Galería de avatares (8 nuevos + scroll con barra lateral)

Sin deploy (regla de oro: avisa al deployer). `npx tsc --noEmit` EXIT=0. Todo
ADITIVO. Archivos dueños de Conv C (`settings/profile/**`, `src/lib/avatars.ts`,
`public/avatars/**`); no se tocaron archivos de A ni B.

### T-avatares — 8 avatares nuevos cargados
- Nuevos: `public/avatars/a15.png` … `a22.png` (copiados de "avatares WLO" del
  usuario). Se compararon por hash MD5 contra los 15 existentes: 15 del folder
  eran byte-idénticos (husky + a01..a14, omitidos) y 8 realmente nuevos.
- Registrados en `src/lib/avatars.ts`: 8 entradas nuevas en `AVATARS` (a15..a22,
  labels "Avatar 15".."Avatar 22"). `AVATAR_PATHS` y `ADMIN_ONLY_AVATARS` se
  derivan solos; husky sigue siendo el único adminOnly. Galería total: husky + 22.

### T-scroll — barra lateral en la galería de perfil
- Editado: `src/app/(app)/settings/profile/ProfileForm.tsx`.
- La cuadrícula de avatares se envolvió en un contenedor `max-h-72 overflow-y-auto`
  con borde suave y `pr-3`, para explorar todos los avatares con scroll sin empujar
  el botón "Guardar". La barra usa el estilo global (webkit 6px). Se agregó un
  contador discreto "{N} avatares" junto al título "Elige tu avatar".
- Sin cambios de lógica: selección, husky adminOnly, PATCH /api/profile intactos.

---

## 2026-07-04: Marketplace v2 (tablero interactivo + ciclo de vida + aprobación admin)

Deploy de producción: `dpl_H5wrGwsX9DL5TnYw7zodeMnePnMz` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) y `next build` EXIT=0 antes de desplegar.
Ruta `/w/[slug]/projects` renderiza HTTP 200 (gate de auth) sin 500. Todo ADITIVO.
Conv A del trabajo de 3 conversaciones en paralelo (esta conv es dueña de:
marketplace de proyectos, migraciones `projects.*`, APIs de ciclo de vida, UI del
tablero). Conv B: modal de tareas + adjuntos + menciones. Conv C: purga de emojis
global + pulido. Partición para no pisarse.

### Contexto de producto (lo que pidió Ali)

Sobre el marketplace base se agrega:
1. Tablero interactivo con tres vistas en un segmento: Abiertos (postularse),
   Mis proyectos (progreso + completar + calificar), Pendientes (solo admin).
2. Proyectos al 100% se pueden marcar COMPLETADOS; al completar se habilita que
   TODOS los participantes se califiquen entre si (antes solo el CV propio).
3. Todos pueden CREAR proyectos, pero solo los administradores (org owner/admin)
   los AUTORIZAN. Propuesto por admin = aprobado y abierto de una; propuesto por
   cualquiera = pendiente hasta que un admin lo apruebe.
4. Cero emojis: iconos lucide en todas las superficies del marketplace/CV.

### Base de datos (verificada por MCP `execute_sql`, ya aplicada)

Proyecto Supabase `cmskiyypeujcgikbvyoz`. La tabla `projects` YA tiene las columnas
del ciclo de vida (no requirió migración nueva en esta sesión): `approval_status`
(text), `approved_by` (uuid), `approved_at` (timestamptz), `completed_at`
(timestamptz), `completed_by` (uuid), ademas de las previas `lead_id`, `scope`,
`rules`, `deliverables`, `open_for_applications`, `application_deadline`,
`max_members`, `status`. Confirmado por `information_schema.columns`.

### APIs (nuevas y editadas por Conv A)

- `POST /api/marketplace/propose` (NUEVA): cualquier miembro del workspace propone.
  Admin -> `approval_status='approved'` + `open_for_applications=true`. No admin ->
  `'pending'` + cerrado; notifica a los admins (`PROJECT_PENDING_APPROVAL`). El
  proponente queda como lider + manager. Corre `create_default_statuses`. Devuelve
  `{ id, slug, approval_status, open_for_applications, pending }`.
- `PATCH /api/projects/[projectId]/approval` (NUEVA): org owner/admin aprueba o
  rechaza pendientes. Zod `{ decision: 'approve' | 'reject' }`. 409 si el proyecto
  ya no esta `pending`. Setea `approval_status`, `approved_by/at`,
  `open_for_applications=(aprobado)`. Notifica al lider (`PROJECT_APPROVED/REJECTED`).
- `PATCH /api/projects/[projectId]/complete` (NUEVA): lider/manager/org-admin marca
  completado. Guardia dura via `computeProjectProgress`: 422 si `total===0`, 422 si
  `pct<100`. Setea `status='completed'`, `completed_at/by`, cierra postulaciones.
  Notifica a TODOS los miembros (`REVIEW_REQUESTED`).
- `POST|GET /api/projects/[projectId]/reviews` (EDITADA): ahora exige que el
  proyecto este `completed`. POST devuelve 409 si no lo esta; GET agrega
  `can_review` al payload segun `status==='completed'`.

### Archivos frontend

- `src/app/(app)/w/[slug]/projects/page.tsx` (REESCRITO): server component arma 3
  datasets. Abiertos filtra `approval_status='approved'`. Mis proyectos calcula
  progreso por proyecto con `computeProjectProgress` y `can_complete = (lider ||
  manager || admin) && status!='completed' && pct===100 && total>0`. Pendientes solo
  si `isAdmin`. Delega a `<ProjectsBoard/>`.
- `src/app/(app)/w/[slug]/projects/ProjectsBoard.tsx` (NUEVO): segmento de 3 tabs
  (lucide Compass/FolderKanban/ShieldCheck + contadores), header con "Mi CV" +
  "Crear proyecto". Paneles: MyProjectsPanel/MyProjectCard (barra de progreso,
  StatusBadge, "Marcar completado" cuando `can_complete`, "Calificar equipo" cuando
  `completed`), PendingPanel/PendingCard (Aprobar/Rechazar), CreateProjectModal (sin
  campo de icono, evita emojis), ReviewModal + RatingForm (4 ejes) + StarRow.
- `src/app/(app)/w/[slug]/projects/MarketplaceBoard.tsx` (EDITADO): purga emoji
  `📋` -> icono `FolderKanban` en tarjeta y en header del modal de postulacion.
- `src/app/(app)/w/[slug]/projects/[projectId]/ManageProject.tsx` (EDITADO): emoji
  del header -> `ScrollText`.
- `src/app/(app)/w/[slug]/cv/[profileId]/CvProjects.tsx` (EDITADO): emoji -> icono
  `FolderKanban` en tarjeta y header del modal.
- `src/lib/activity.ts` (EDITADO previamente): verbos `PROJECT_PROPOSED/APPROVED/
  REJECTED/COMPLETED` + tipos de notificacion `PROJECT_APPROVED/REJECTED/
  PENDING_APPROVAL`.

### Landmines resueltas

- `w-4.5 h-4.5` NO son clases Tailwind validas (no hay entrada "4.5" en la config).
  Estaban en 4 lugares (CvProjects, MarketplaceBoard, ProjectsBoard x2). Cambiadas a
  `w-5 h-5`. Regla: no inventar escalas de spacing, verificar contra la config.
- Anti-patron de fetch en fase de render en el ReviewModal: reemplazado por
  `useEffect` con bandera `alive` para cancelar.

### Pendiente (no de Conv A)

- Conv B: rediseño estetico del modal de tareas + adjuntos (`task_attachments` +
  Storage) + menciones (`task_mentions`).
- Conv C: purga de emojis en el resto (notas, teams, NewProjectForm) + pulido.

---

## 2026-07-04: Marketplace de Proyectos Internos (postulación + CV + reputación anónima)

Deploy de producción: `dpl_7Jz796izqy8xFBhzXXoejj6oJnFw` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) y `next build` EXIT=0 antes de desplegar.
Para el equipo de We Love Paving. Todo ADITIVO: cero cambios destructivos a la BD
ni a features vivas (scrum, pizarra, tareas, chat, notas siguen intactas).

### Contexto de producto (la nueva lógica)

Se pasa del modelo "a la gente se le asigna a dedo" a un MARKETPLACE interno:
1. Postulación: los miembros exploran proyectos ABIERTOS y se postulan con un pitch.
2. Líderes por proyecto (no organizacionales): cada proyecto tiene su líder que
   define charter (alcance, reglas, entregables, cupo, deadline) y acepta/rechaza.
3. Calificación anónima entre compañeros del mismo proyecto: 4 ejes
   (colaboración, calidad, confiabilidad, comunicación 1-5) + comentario.
4. CV interno por perfil: historial de proyectos + reputación agregada.
Objetivo: unificar para que no haya tantos grupos ni tantas juntas.

### Base de datos (ya aplicada, verificada por MCP `execute_sql`)

Proyecto Supabase `cmskiyypeujcgikbvyoz`. Confirmado que YA existen (no requirió
migración nueva en esta sesión):
- `projects`: columnas `open_for_applications`, `application_deadline`,
  `max_members`, `lead_id`, `scope`, `rules`, `deliverables`, `is_archived`, `status`.
- Tablas `project_applications` y `project_reviews`.
- RPC `profile_reputation(p_profile_id uuid)` (SECURITY DEFINER, devuelve 1 fila
  en array; k-anonimato: `avg_*` en NULL hasta `review_count >= 3`).
- FKs nombrados que usan los selects embebidos de PostgREST:
  `project_applications_applicant_id_fkey`, `project_members_project_id_fkey`,
  `project_members_profile_id_fkey`, `projects_lead_id_fkey`,
  `project_reviews_reviewer_id_fkey`, `project_reviews_reviewee_id_fkey`.

### API (6 endpoints, admin client + verificación de autoridad en handler = anti-IDOR)

- `GET /api/marketplace`: proyectos abiertos de los workspaces del solicitante,
  con estado por proyecto (`is_member`, `my_application_status`) y `member_count`.
- `POST /api/projects/[projectId]/applications`: postularse (pitch 10-2000 chars +
  rol deseado). Valida apertura, deadline vigente, membresía de workspace, no ser
  ya miembro, y no duplicar (unique 23505). Notifica al líder o creador.
- `GET /api/projects/[projectId]/applications`: solo líder/manager/org admin listan.
- `PATCH /api/applications/[applicationId]`: `accepted`/`rejected` (líder/manager/
  admin) o `withdrawn` (el propio postulante). Al aceptar: respeta `max_members`,
  da de alta como miembro (`upsert onConflict project_id,profile_id`, título =
  rol deseado), notifica al postulante, y registra actividad.
- `POST /api/projects/[projectId]/reviews`: calificación anónima (4 ejes + comment,
  unique por par 23505). El log de actividad apunta al PROYECTO, nunca al evaluado,
  para preservar anonimato. `GET`: compañeros del proyecto (member-only, excluye a
  uno mismo, marca a quién ya calificaste).
- `PATCH /api/projects/[projectId]/charter`: edita alcance/reglas/entregables/
  cupo/deadline/apertura y reasigna líder (debe ser miembro). Registra abierto/cerrado.

### Pantallas / UI (todas en `src/app/(app)/w/[workspaceSlug]/`)

- `projects/page.tsx` + `MarketplaceBoard.tsx`: grilla de proyectos abiertos con
  modal de postulación (pitch + rol).
- `projects/[projectId]/page.tsx` + `ManageProject.tsx`: hub del líder (editor de
  charter + panel de postulaciones aceptar/rechazar + equipo actual).
- `cv/[profileId]/page.tsx` + `CvProjects.tsx`: CV interno (stats, panel de
  reputación con gate de k-anonimato, historial de proyectos) + modal de
  calificación anónima por proyecto (visible solo en el CV propio, `isOwn`).
- `src/components/sidebar/Sidebar.tsx`: dos entradas nuevas ("Proyectos abiertos"
  y "Mi CV") con iconos SVG propios (`MarketplaceIcon`, `CvIcon`).

### Fix de build

Lint `@typescript-eslint/no-unused-vars`: prop `projectId` muerta en
`ApplicationsPanel` (la decisión usa el id de la postulación, no del proyecto).
Removida de la firma y del call site. `next build` EXIT=0 después.

### Pendiente (depende de contenido de la conversación paralela)

Especialización WLP: taxonomía de áreas, proyectos semilla con charter real, copy
deck ES definitivo, rúbrica de calificación y plan de rollout. Se integran cuando
lleguen esos `.md`. Smoke test funcional end-to-end pendiente (requiere sesión
autenticada de un usuario WLP).

---

## 2026-07-01: Tablero Scrum arreglado (taxonomía de categorías) + activar sprint

Deploy de producción: `dpl_8sEAoYZMFfxpZW842mgZXWDePGx5` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) antes de desplegar.

### T40: Bug raíz del tablero Scrum (categorías desalineadas)

Síntoma: "el tablero de Scrum no sirve bien". Las tarjetas no aparecían en las
columnas. Causa: el tablero filtraba por categorías `not_started` / `active` /
`done`, pero la taxonomía real de la BD (función `create_default_statuses`) es
`todo` / `in_progress` / `done` / `cancelled`. Toda tarea con categoría `todo` o
`in_progress` (la mayoría) no hacía match con ninguna columna: invisible aunque
estuviera en el sprint.

Corrección (solo frontend, la BD ya era correcta):
- `src/components/scrum/types.ts`: `SCRUM_COLUMNS` ahora `todo` / `in_progress` / `done`.
- `src/components/scrum/ScrumWorkspace.tsx`: renombradas las llaves de `COLUMN_META`
  (`not_started`->`todo`, `active`->`in_progress`) y corregidos ~10 puntos con
  comparaciones/defaults de categoría (salud del tablero, drag-and-drop
  `canDropHere`/`handleDrop`, render de columnas, WIP Kanban, `KanbanDashboard`,
  `CategoryDot`). Los `'active'` del ciclo de vida del SPRINT (planning/active/
  completed) se dejaron intactos: son un enum distinto.
- `src/lib/utils.ts`: `STATUS_CATEGORY_COLORS` re-llavado a `todo`/`in_progress`.
- `src/lib/supabase/types.ts`: union de categorías corregida a la real.

### T41: "Activalo" + estado vacío útil del sprint

- Estado vacío del tablero: cuando el sprint seleccionado tiene 0 tareas, en vez
  de tres columnas muertas (que se leen como "roto") se muestra `SprintBoardEmpty`
  con el siguiente paso claro: botón "Iniciar sprint" si sigue en plan (llama
  `patchSprint status=active`) y "Ver Backlog" si hay tareas para enviar. Icono
  `Play`/`ClipboardList`/`Inbox` (lucide).
- Dato del equipo Marketing / Paid Media: su sprint "NEW TEST" estaba en
  `planning` con 0 tareas y sus 2 tareas de prueba en el backlog. Se activó el
  sprint y se enviaron ambas tareas al sprint (SQL, workspace propio, reversible
  desde la UI) para que el tablero se vea funcionando de inmediato.

### Qué funciones siguen (Scrum, propuestas para Ali)

Burndown real del sprint (ya hay Dashboard, falta la curva ideal vs real),
capacidad por persona (SP asignados vs límite), arrastrar del backlog al tablero
sin abrir tarea, cierre de sprint con "carry over" al siguiente, y meta del sprint
editable inline.

## 2026-07-01: Auditoría multiagente (seguridad P0 + accesibilidad + pulido)

Deploy de producción: `dpl_dC1hdoBHZ4j8RiU3uTTxis5QAFjc` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) antes de desplegar.

Contexto: Ali pidió "audita y lanza varios agentes para revisar y mejorar todos los
elementos existentes". Se lanzaron 4 agentes de auditoría de solo lectura (dotados de
las guías Web Interface Guidelines de Vercel), cada uno con su lista priorizada. Yo
verifiqué cada hallazgo leyendo el código real (los agentes pueden alucinar) e
implementé las correcciones de mayor valor de forma centralizada para no chocar entre
escrituras paralelas sobre un typecheck de proyecto completo.

### T38: Seguridad backend (P0/P1 verificadas)
- IDOR en los 4 handlers de checklist-items (`/api/tasks/[taskId]/checklist-items`
  GET+POST y `.../[itemId]` PATCH+DELETE): usaban `createAdminClient()` (bypass RLS)
  sin verificar pertenencia al proyecto, así cualquier usuario autenticado podía
  leer/alterar checklists de tareas ajenas por ID. Se creó el helper compartido
  `src/lib/task-access.ts` (`checkTaskAccess`): carga la tarea, saca `project_id`,
  valida `project_members` del usuario, devuelve 404/403. Cableado en los 4 handlers.
- Open redirect en `/api/auth/callback`: el parámetro `next` solo se validaba con
  `startsWith('/')`, que deja pasar `//host` y `/\host` (redirect protocolo-relativo
  a dominio externo). Ahora exige `/` y rechaza `//` y `/\`.
- KERN (`/api/kern`): topes anti-abuso al payload (máx 40 mensajes, 24k caracteres
  totales) para evitar prompts gigantes contra el modelo. Devuelve 413.
- `/api/tasks` POST: se quitó un `console.log` que volcaba datos de la tarea (PII) al
  log del servidor.

### T39: Accesibilidad y pulido de UI
- `TaskDetailPanel`: se añadió semántica de diálogo (`role="dialog"`,
  `aria-modal="true"`, `aria-label`), `aria-hidden` en el overlay y `aria-label` en
  los botones de icono (eliminar, cerrar). Ya tenía Escape y click-fuera para cerrar.
- `NavSection` (sidebar): la ruta activa usaba `bg-accent`, idéntico al hover, así el
  ítem seleccionado se volvía indistinguible al pasar el cursor. Se añadió una barra
  de acento amarilla de marca (`before:bg-primary`) en Scrum, Chat y proyectos, y
  `ring-primary/50` al icono de equipo colapsado.
- `WelcomeSplash`: `motion-reduce:transition-none` y `motion-reduce:transform-none`
  para respetar `prefers-reduced-motion`.
- `CreateTaskInline`: el `onBlur` creaba la tarea automáticamente al hacer click
  fuera con texto, generando tareas accidentales. Ahora la creación es explícita
  (Enter crea, Escape descarta); el blur solo cierra si el campo está vacío.
- `TaskListView`: estado vacío rediseñado (panel punteado + icono `ListTodo` +
  jerarquía) en vez de dos párrafos sueltos.
- Se reemplazó un guion largo residual (icono "Sin prioridad" en `PRIORITIES`) por un
  guion normal, por la regla del proyecto.

Pendiente (backlog de auditoría, no bloqueante, a priorizar con Ali): trampas de foco
en modales (TaskDetailPanel, CommandPalette), `aria-label` en botones de icono del
resto de componentes, Escape/click-fuera en menús, envío optimista + scroll en
TeamChat, reemplazo de `confirm()/prompt()` nativos. Decisión de producto abierta: en
notas y pizarras el PATCH permite editar a cualquier miembro (incluido viewer); es
política de roles, no vulnerabilidad, se dejó sin cambiar.

## 2026-07-01 — Abrir tareas desde el Scrum + Backlog rediseñado

Deploy de producción: `dpl_GDY64z2D7yE4K5EXo3gShgpiWLqi` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) antes de desplegar.

Contexto: Ali mostró el Backlog en modo Scrum y dijo "no puedo abrir tareas, mejora
este menú, se ve muy simple". Antes ninguna tarjeta del scrum abría el detalle de la
tarea. Solo UI en `ScrumWorkspace.tsx` (reusa componentes existentes), sin API ni
migración.

### T37 — Abrir el detalle de tarea desde el scrum
- Se reusa el `TaskDetailPanel` (mismo panel deslizante del tablero clásico) dentro
  de `ScrumWorkspace`: nuevo estado `openTaskId`, se filtran los `statuses` al
  proyecto de la tarea abierta y se reconcilia el estado optimista `localTasks` con
  `onUpdated`/`onDeleted` (así la tarjeta refleja el cambio sin esperar al realtime).
- Ahora abren tarea: el título de las tarjetas del Tablero (Scrum y Kanban), las
  filas del Daily/Por persona, y las tarjetas del Backlog. El título es un botón con
  hover a color primario; los controles internos (puntos, mover, enviar a sprint) no
  disparan la apertura.

### T38 — Backlog rediseñado (menos simple)
- Banda de contexto con icono `Inbox`, título, subtítulo y chips de resumen
  (total tareas `Layers`, story points `Gauge`, salud de estimación en ámbar/esmeralda).
- Buscador cliente (`Search`) para filtrar el backlog por texto.
- Grupos por área con punto de acento de `AREA_COLORS`, contador y story points por área.
- Tarjetas con borde-izquierdo de color de área, chevron de prioridad, proyecto,
  `DueBadge`, marca de vencida (`Flame`), avatar, selector de puntos y "Enviar a…"
  con hover lift, consistentes con el estilo premium de los dashboards.
- Estados vacíos propios (backlog vacío / sin coincidencias de búsqueda).

---

## 2026-07-01 — Rediseño del Dashboard (Scrum y Kanban) más moderno

Deploy de producción: `wlo-ci1lftng0` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) antes de desplegar.

Contexto: Ali pidió que el panel de métricas se viera "más estético y moderno" y
que "lo de Scrum no lo veía". Solo UI en `ScrumWorkspace.tsx`, sin API ni migración.

### T34 — Tarjetas de métrica premium
- Nuevo `Score` con chip de icono `lucide-react` de color de acento (blue, green,
  amber, violet, rose, slate), número grande tabular y micro-interacción en hover
  (elevación + escala del icono). En alerta (`tone warn`) la tarjeta se tiñe de
  naranja. Cada KPI recibió su icono y color: WIP=Loader2 azul, Completadas=
  CheckCircle2 verde, Vencidas=AlertTriangle rojo, etc.

### T35 — Gráficas pulidas y consistentes
- Nuevo contenedor `ChartCard` (encabezado con icono + título) y estilo de tooltip
  compartido `TOOLTIP_STYLE` acorde al tema. Barras con esquinas redondeadas
  (`radius 6`), `CartesianGrid` sutil, ejes sin línea, `Legend` de puntos. El pie
  de "Mix por área" pasó a dona (`innerRadius`) con separación entre gajos. Empty
  state de gráfica con icono y fondo punteado.

### T36 — Scrum visible y diferenciado en el dashboard
- Cada panel abre con una banda de contexto: azul "Panel de flujo" (Kanban, la
  métrica reina es el WIP) vs primaria "Panel de sprint" (Scrum, nombra el sprint
  y habla de velocity/avance/precisión). Así el dashboard de Scrum ya no se
  confunde con el de Kanban.

---

## 2026-06-30 — Splash más estético + Scrum y Kanban diferenciados

Deploy de producción: `dpl_AjgqSraXqqyn6PxsEpRdTwTng2Eq` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) antes de desplegar.

Contexto: feedback de Ali sobre el splash recién lanzado ("más minimalista y
estético, un círculo, el saludo en cursiva") y sobre que los tableros de Scrum y
Kanban se veían idénticos.

### T32 — Splash de bienvenida más minimalista
- En `WelcomeSplash.tsx` el avatar pasó de rectángulo redondeado a círculo puro
  (`rounded-full`) con anillo suave y sombra tenue. El saludo "Hola, {nombre}" es
  ahora tipografía ligera en cursiva (`font-light italic tracking-tight`), más
  aire arriba (`mt-7`). Sigue mostrándose una vez por sesión.

### T33 — Scrum y Kanban visualmente diferenciados
- En `ScrumWorkspace.tsx` (solo UI, sin API ni migración) el mismo `BoardView`
  ahora se lee distinto según el modo:
  - Banner de modo arriba del tablero: azul "Flujo continuo (Kanban)" con nota de
    límite WIP, vs primario "Sprint activo (Scrum)" con nota de story points.
  - Métrica de encabezado de columna: Kanban muestra `{n} / {wipLimit} WIP`
    (naranja si rebasa) y barra activa azul; Scrum mantiene `{n} · {pts} SP`.
  - Chip de salud: Kanban muestra `WIP {enCurso}/{wipLimit}`; Scrum mantiene
    "sin estimar". Los datos y las tareas son los mismos: solo cambia la lente.

---

## 2026-06-30 — Ajustes de perfil + avatar en el saludo + splash de bienvenida (Netflix)

Deploy de producción: `dpl_59Qs4dgopKTH1G5n8VSA4etsuWFg` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) antes de desplegar.

Contexto: feedback de Ali sobre la página Mi perfil recién lanzada y la home.

### T27 — Botón Guardar siempre visible + Regresar al Menú
- En `ProfileForm.tsx` la barra de acciones ahora es `sticky bottom-0` con
  `backdrop-blur` y borde superior: el botón "Guardar cambios" ya no se pierde bajo
  el fold. En móvil los botones se apilan (`flex-col-reverse`), en desktop van a los
  lados. El botón sigue deshabilitado si no hay cambios (`!dirty`) pero con `title`
  que explica por qué. Nuevo link "Regresar al Menú" (icono `Home`) que va a `/`.

### T28 — Husky asignado directo a Alí Espejel
- Además de reservarlo a admins, se asignó el husky al perfil de Alí por SQL
  (Supabase MCP): `UPDATE profiles SET avatar_url='/avatars/husky.png'` donde
  `id=5a78b212-...` (email `ali.eg@pavific.com`, `org_role owner`).

### T29 — Avatar en el saludo "Hola, {nombre}"
- La home (`w/[workspaceSlug]/page.tsx`) ahora carga `avatar_url` y muestra el
  avatar del usuario junto al saludo, como link a `/settings/profile`. Header
  responsivo (`gap-3 sm:gap-4`, título `text-2xl sm:text-3xl truncate`).

### T30 — Splash de bienvenida estilo Netflix
- Nuevo `src/components/WelcomeSplash.tsx` (cliente): al entrar a la app lo primero
  que ve el usuario es su avatar grande + "Hola, {nombre}" con fade/scale, y luego
  se desvanece (~2.3s). Se muestra UNA vez por sesión del navegador
  (`sessionStorage` key `wlo-welcome-seen`). Montado en el layout `(app)`, que ahora
  carga `display_name`+`avatar_url` del perfil server-side.

### T31 — Responsividad
- Revisadas y ajustadas home (header) y Mi perfil (padding `p-4 sm:p-6`, barra de
  acciones apilable). El grid de la galería ya era responsivo (`grid-cols-4 sm:grid-cols-6`).

---

## 2026-06-30 — Galería de avatares WLO + página Mi perfil (husky reservado al Admin)

Deploy de producción: `dpl_6BRtEb2axHoDAraN15y173nuo5kz` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) antes de desplegar.

Contexto: Ali entregó 15 avatares mascota (branding WLP, acentos amarillos) en
`C:\Users\GRIZZLY\Desktop\avatares WLO`. Hasta ahora `avatar_url` solo se seteaba
una vez en el onboarding desde OAuth y NO había forma de cambiarlo en la app; peor
aún, el link "Mi perfil" del UserMenu apuntaba a `/settings/profile`, una página
inexistente (404). Regla explícita de Ali: el avatar del husky es SOLO para el Admin.

### T23 — Avatares como estáticos
- Los 15 PNG se copiaron a `public/avatars/` con nombres limpios: `husky.png` +
  `a01.png`..`a14.png`. Se sirven same-origin (CSP `img-src 'self'` ya los permite,
  sin tocar `next.config`). Sin bucket de storage, sin subida, sin migración
  (`profiles.avatar_url` ya existe).

### T24 — Manifest + gating del husky
- Nuevo `src/lib/avatars.ts`: `AVATARS` (ruta+label+adminOnly), `AVATAR_PATHS`,
  `ADMIN_ONLY_AVATARS` (husky) y `ADMIN_ROLES` (`admin`/`owner`). El husky es
  `adminOnly`. La regla se valida en DOS capas: UI (candado, no seleccionable) y
  servidor.

### T25 — API PATCH /api/profile
- Nuevo `src/app/api/profile/route.ts`: el usuario edita SOLO su propio perfil
  (`display_name` 2..80, `avatar_url`). Valida que el avatar sea de la galería;
  si es reservado (husky), exige `profiles.org_role` en (`admin`,`owner`) o
  devuelve 403. Rate-limit + zod `.strict()`, patrón calcado de `/api/teams/[teamId]`.

### T26 — Página Mi perfil
- Nuevas `src/app/(app)/settings/profile/page.tsx` (server, carga perfil + calcula
  `isAdmin`) y `ProfileForm.tsx` (cliente): preview de avatar + nombre, galería en
  grid con opción "Sin avatar" (iniciales), check de selección, y el husky con
  candado + gris para no-admins (toast si lo intentan). Guarda vía PATCH y
  `router.refresh()` para que el sidebar y el tablero reflejen el cambio. Esto
  ARREGLA el link muerto del UserMenu.

---

## 2026-06-30 — Migración a iconos + funciones de tablero (Nivel D: lucide, buscar, swimlanes, orden, salud)

Deploy de producción: `dpl_3jbxrUc9VLeeF1mZifhdj3uzzDi5` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) antes de desplegar.

Contexto: el usuario rechazó los emojis del Nivel C ("no me gustan los emojis,
quiero que sean iconos") y pidió planear y agregar nuevas y mejores funciones.
Solo UI en `ScrumWorkspace.tsx`, sin API ni migración. Se usa `lucide-react`
(ya era dependencia, antes sin usar).

### T17 — Cero emojis: todo con iconos lucide
- `COLUMN_META` ahora lleva componente `Icon` (Inbox 📋→lucide, Loader2 girando
  para la columna activa, CheckCircle2 hecho) en vez de emoji; `PRIORITY_META`
  usa escala de chevrons estilo Linear (ChevronsUp urgente, ChevronUp alta, Equal
  media, ChevronDown baja, Minus sin prioridad) con color por nivel.
- SprintBar (título, toggle admin Scrum/Kanban, badge no-admin, línea de meta),
  chips de mover columna, warning de WIP y EmptyState migrados a iconos
  (Timer/Columns3/Target/AlertTriangle/Rocket). No queda ningún emoji en el panel.

### T18 — Buscar tarjetas
- Input de búsqueda en la barra de control: filtra en cliente por título, área y
  proyecto. Aplica a ambos modos (Scrum y Kanban).

### T19 — Swimlanes (agrupar el tablero)
- Nuevo control de agrupación: Ninguno / Persona / Prioridad (`groupBy`). Cada
  carril renderiza la misma grilla de 3 columnas con su encabezado (avatar o
  bandera de prioridad). El resalte de drop se acota por clave compuesta
  `${laneId}:${category}` para no iluminar la misma categoría en todos los carriles.

### T20 — Ordenar dentro de columna
- Selector de orden: Natural / Prioridad / Fecha límite / Story points
  (`sortBy` + helper `sortTasks`). El drag-and-drop nativo sigue igual.

### T21 — Resumen de salud del tablero
- Fila de KPIs en cliente: visibles, en curso, en riesgo (vencidas sin cerrar),
  sin estimar. Da lectura rápida del estado sin abrir el Dashboard.

### T22 — Persistencia de preferencias por equipo
- `groupBy`, `sortBy` y filtros de vencidas/sin asignar se guardan en
  `localStorage` bajo `wlo-scrum-board-${teamId}`. El efecto de carga corre al
  montar y gana sobre el default. Filtros efímeros (búsqueda, selección de
  personas) no se persisten.

---

## 2026-06-30 — Rediseño estético del Scrum (Nivel C: emojis, identidad, control)

Deploy de producción: `dpl_CyY8xDwSBDPAcKevRM8MNd65JRXd` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) antes de desplegar.

Contexto: el tablero funcionaba pero se sentía plano y usaba flechas de texto
("→ En progreso") para mover tarjetas. Se pidió hacerlo más estético, dinámico e
intuitivo, cero flechas (todo con emojis) y que la metodología quede más
gobernable. Solo UI en `ScrumWorkspace.tsx`, sin API ni migración.

### T11 — Identidad visual por columna (emojis + acento)
- Nuevas consts a nivel de módulo: `COLUMN_META` (📋 Por hacer, 🚧 En progreso,
  ✅ Hecho) con color de header, barra de acento y estilos de "soltar aquí" por
  categoría; `COLUMN_FALLBACK` para categorías desconocidas; `colMeta()`.
  `PRIORITY_EMOJI` + `priorityEmoji()` como semáforo (🔴 urgent, 🟠 high, 🟡
  medium, 🔵 low, ⚪ none).
- Cada columna ahora lleva su emoji, título en color de acento, contador
  "n · SP" y una barra fina de color. El resalte de drop usa el color de la
  columna destino (antes todo primary).

### T12 — Cero flechas: chips de emoji para mover
- Los botones "→ {columna}" se reemplazan por chips con el emoji de la columna
  DESTINO (📋 / 🚧 / ✅). Deshabilitados si el proyecto no tiene estado
  equivalente. El drag-and-drop nativo sigue igual como gesto principal.

### T13 — Tarjetas más vivas
- Emoji de prioridad como indicador líder, hover con elevación (shadow +
  translate) y borde de realce, badge de fecha (`DueBadge`, naranja si vencida)
  ahora también en la tarjeta del tablero, área truncada.

### T14 — Barra de control del tablero (más gobernable)
- Nueva barra de filtros en cliente (sin tocar BD): avatares por persona (toggle
  con ring primary), "🔥 Vencidas", "🙋 Sin asignar" y "✖ Limpiar". Aplica a
  ambos modos (Scrum y Kanban). Los avatares solo listan a quien tiene tareas.
- `BoardView` ahora recibe `members` (ambos call sites). Alerta ⚠️ de WIP en la
  columna "en curso" de Kanban cuando rebasa el límite sano (2 por persona).

### T15 — Toggle de metodología tipo segmento
- El `<select>` de metodología se vuelve un toggle segmentado "🏃 Scrum" /
  "📋 Kanban" para admin (un clic, más intuitivo); los demás ven etiqueta fija
  con emoji. Mensajes de tablero vacío ahora con emoji.

### T16 — Build + deploy
- `tsc --noEmit` limpio, deploy a Vercel producción OK.

---

## 2026-06-30 — Selector de metodología (Nivel B: Scrum ↔ Kanban)

Deploy de producción: `dpl_FxP9dz67kzWxBkwTNxFPhN1qzkuA` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) antes de desplegar.

Contexto: el panel ágil solo hablaba Scrum (sprints obligatorios). Se agregó un
selector por equipo para trabajar en Kanban (flujo continuo) sin sprints. Cambio
ADITIVO: los equipos existentes quedan en `scrum` por default, el comportamiento
actual no cambia hasta que un admin decida.

### T6 — Migración aditiva `methodology` en teams
- Nuevo: `supabase/migrations/20260701000000_team_methodology.sql`.
- `ALTER TABLE teams ADD COLUMN IF NOT EXISTS methodology text NOT NULL DEFAULT
  'scrum' CHECK (methodology IN ('scrum','kanban'))`. Aplicada al proyecto vivo
  (`cmskiyypeujcgikbvyoz`) por Supabase MCP `apply_migration`, no por deploy.
  Sin backfill destructivo, sin borrado de datos.

### T7 — API: PATCH /api/teams/[teamId] acepta methodology
- Editado: `src/app/api/teams/[teamId]/route.ts`.
- Se añadió `methodology: z.enum(['scrum','kanban']).optional()` al zod `.strict()`.
  Sigue admin-only (rol admin del equipo o 403). El update ya era genérico
  (`...parsed.data`), así que no hubo que tocar la query.

### T8 — Loader del panel pasa la metodología
- Editado: `src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/scrum/page.tsx`.
- La query del equipo ahora selecciona `methodology`; se pasa como prop a
  ScrumWorkspace (normalizada a 'scrum' | 'kanban').

### T9 — ScrumWorkspace bimodal (Scrum/Kanban)
- Editado: `src/components/scrum/ScrumWorkspace.tsx`.
- Prop `methodology` + estado optimista (`switchMethodology`: cambia la lente al
  instante, PATCH en segundo plano, revierte si falla). Selector en la barra
  superior visible solo para admin (los demás ven una etiqueta de solo lectura).
- Kanban reusa las MISMAS tareas (cero duplicación): el Tablero muestra TODO el
  flujo (sin filtro de sprint), y desaparecen el selector de sprint, el estado de
  sprint, el botón "+ Sprint" y la pestaña Backlog. La pestaña "Daily" se renombra
  "Por persona" (agrupa por dueño sin depender de un sprint).
- Nuevo Dashboard Kanban (`KanbanDashboard`): métricas de FLUJO en vez de velocity
  de sprint. WIP en curso vs límite sano (2 por persona), completadas, por hacer,
  total, vencidas sin cerrar (cuellos de botella), sin asignar, capacidad, ratio de
  cierre. Gráficas: distribución por columna, carga por persona (en curso/hechas),
  mix por área.
- El drag-and-drop, la presencia en vivo y el estado optimista del Nivel A siguen
  funcionando igual en ambos modos (el tablero es el mismo componente BoardView).

### T10 — Build + deploy
- `tsc --noEmit` limpio, deploy a Vercel producción OK.

---

## 2026-06-30 — SCRUM dinámico (Nivel A: drag-and-drop + optimista + presencia)

Deploy de producción: `dpl_5nFjd6PD8rFvfqUGFzrqKvfKL9Ey` (alias `wlo.vercel.app`).
Typecheck limpio (`tsc --noEmit` EXIT=0) antes de desplegar.

Contexto: el panel Scrum ya tenía las vistas completas (Tablero por columnas,
Backlog, Daily/standup, Dashboard con KPIs, sprints con fases
planning/active/completed). Faltaba la dinámica. Se agregó sin migración de BD,
reusando la API existente (PATCH /api/tasks/[id] y /api/sprints).

### T1 — Hook reutilizable `usePresence`
- Nuevo: `src/hooks/usePresence.ts`.
- Extrae el patrón de presencia en vivo que ya usaba la pizarra (Supabase
  Realtime Presence) a un hook reusable. Devuelve los OTROS usuarios viendo la
  misma superficie; auto-track al suscribirse, limpia canal al desmontar.

### T2 — BoardView con drag-and-drop nativo
- Editado: `src/components/scrum/ScrumWorkspace.tsx` (BoardView).
- Drag-and-drop HTML5 nativo (draggable / onDragStart / onDragOver / onDrop),
  sin dependencia extra. Arrastrar una tarjeta entre columnas
  Por hacer / En progreso / Hecho la mueve de estado.
- Validación: solo permite soltar si el proyecto de la tarea tiene un estado
  equivalente a esa columna. Resalte visual de la columna destino (ring primary)
  y "Suelta aquí" en columnas vacías mientras se arrastra. La tarjeta arrastrada
  baja a opacity-40. Los botones "→ columna" siguen ahí como respaldo táctil/a11y.

### T3 — Estado optimista de tareas (sin parpadeo)
- Editado: `src/components/scrum/ScrumWorkspace.tsx`.
- `localTasks` (useState sincronizado desde props por useEffect). Mover, estimar
  (story points) y enviar a sprint pintan el cambio al instante; el PATCH corre
  en segundo plano (`patchTaskRequest`, sin router.refresh). Si el servidor
  rechaza, se revierte a `tasks`. El realtime (useRealtimeRefresh) reconcilia con
  la verdad del servidor cuando llegan props nuevas. Dashboard lee de `localTasks`
  para no desincronizarse del tablero.

### T4 — Tira de presencia en SprintBar
- Editado: `src/components/scrum/ScrumWorkspace.tsx` (SprintBar + átomo PresenceStrip).
- Junto al título "Scrum · equipo": avatares de quién está viendo el scrum ahora
  (máx 4 + contador "+N") con punto verde pulsante = señal "en vivo". Canal de
  presencia `scrum-presence-<teamId>`. El nombre del usuario se deriva de
  `members` (la page ya pasa `currentUserId`).

### T5 — Build + deploy
- `tsc --noEmit` limpio, deploy a Vercel producción OK.

---

## Antes de 2026-06-30 (sesiones previas, resumen)

- Pizarra colaborativa (Excalidraw) con presencia en vivo: funcionando.
- Bug de ancho de la pizarra RESUELTO: el div raíz del layout del workspace
  (`src/app/(app)/w/[workspaceSlug]/layout.tsx`) no tenía `flex-1`; el
  posicionamiento `absolute` de Excalidraw colapsaba la fila flex a ~135px. Fix:
  `flex-1 min-w-0 w-full` en el contenedor. Desplegado (pendiente que el usuario
  haga hard-refresh Ctrl+Shift+R para verificar).

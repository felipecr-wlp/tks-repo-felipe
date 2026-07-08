# TSKR / WLO — Auditoría completa + Plan maestro (3 conversaciones)

Fecha: 2026-07-04. Autor: orquestador (esta conversación = deployer final).
Fuente de verdad viva del producto: `docs/COLAB-CHANGELOG.md`.

---

## 1. Qué existe hoy (auditado en código, no supuesto)

### Estructura de datos (Postgres, proyecto `cmskiyypeujcgikbvyoz`)
Jerarquía: **Organization → Workspaces → Teams → Projects → Tasks**.

Tablas presentes: `organizations`, `profiles`, `org_members`, `workspaces`,
`workspace_members`, `workspace_invites`, `teams`, `team_members`, `projects`,
`project_members`, `project_applications`, `project_reviews`, `tasks`,
`task_statuses`, `task_comments`, `task_checklists`, `task_checklist_items`,
`task_dependencies`, `task_labels`, `labels`, `sprints`, `notes`, `note_versions`,
`whiteboards`, `attachments`, **`messages`** (chat de equipo:
`id, team_id, workspace_id, author_id, body, created_at`),
`google_connections` (`profile_id, google_user_id, access_token, refresh_token,
token_expiry, scopes[]`), `google_drive_links`, `google_sheet_links`,
`activity_events`, `notifications`.

Helpers SQL: `auth_org_id()`, `is_org_admin()`, `create_default_statuses(project)`,
`profile_reputation(profile)`. RLS activo en todas las tablas. Bucket Storage: `attachments`.

### Patrón de seguridad (repetir SIEMPRE en APIs nuevas)
- `createClient()` para auth (`supabase.auth.getUser()`), 401 si no hay user.
- `createAdminClient()` (service_role) para leer/escribir datos, con **re-chequeo de
  membresía en el handler** (anti-IDOR). No confiar en el front.
- Validación `zod` `.strict()`, `applyRateLimit(request)` al inicio en POST/PATCH.
- Tablas nuevas: usar `(admin as any).from('tabla')` (el codebase ya lo hace, ver
  `api/messages/route.ts`). **NO editar a mano `src/lib/supabase/types.ts`**: el
  deployer regenera los tipos una sola vez al final.

### Features ya construidas
- Scrum + Kanban (`ScrumWorkspace`, `KanbanBoard`, dnd, KPIs, presencia).
- Marketplace de proyectos v2 (tablero Abiertos / Mis proyectos / Pendientes,
  proponer, aprobar admin, marcar completado, reviews anónimas k-anon >=3).
- Chat **de equipo** (`TeamChat` + `/api/messages`, realtime).
- Modal de tarea (`TaskDetailPanel`: título, descripción Tiptap, estado, prioridad,
  asignado, fecha, checklist, comentarios).
- CV por perfil (historial + reputación k-anon), Notas, Pizarras (Excalidraw), Bandeja.
- Google OAuth base: tabla `google_connections` + `googleapis` instalado
  (scopes actuales: drive.readonly, sheets.readonly). **Sin scope ni UI de Calendar.**

### Huecos reales (lo que pidió el usuario y NO existe)
1. **Sidebar/menú** poco jerarquizado (lista plana, sin grupos).
2. **Chat de proyecto** (solo hay de equipo).
3. **Google Calendar** (no hay scope, ni API, ni página; solo la tabla base OAuth).
4. **Time tracking** (no hay tabla, ni timer, ni reportes).
5. **Adjuntos y @menciones** en el modal de tareas.
6. **Modal de tareas más estético**.
7. **Scores/CV** pulido visual (existe la lógica, falta jerarquía visual).
8. Emojis sueltos que faltan migrar a iconos lucide.

---

## 2. Regla de oro anti-colisión

Las 3 conversaciones editan **el mismo disco** (`C:\Users\GRIZZLY\Desktop\TSKR`),
no ramas separadas. Por eso: **cada archivo tiene UN solo dueño.** Nadie edita un
archivo de otra. Los puntos de contacto compartidos se resuelven así:

- **`src/lib/activity.ts`** (tipos de notificación): dueño único = **Conv B**.
  Si A o C necesitan un tipo nuevo, lo piden aquí; no lo tocan.
- **`src/lib/supabase/types.ts`**: nadie lo edita a mano. Cada quien usa `as any`
  para sus tablas nuevas. El **deployer** regenera con MCP al final.
- **Migraciones**: cada conv aplica la suya con Supabase MCP `apply_migration`
  (tablas distintas = sin colisión). Nombres de archivo distintos.
- **Deploy**: **NADIE despliega.** Cada conv (a) aplica su migración, (b) corre
  `cd "C:\Users\GRIZZLY\Desktop\TSKR" && npx tsc --noEmit` hasta `EXIT: 0`, (c) avisa
  "listo". El deployer regenera tipos, corre build y hace **UN** deploy con todo.

Contratos de rutas fijos (para que A pueda enlazar sin esperar a B/C):
`/w/[slug]/calendar` (A), `/w/[slug]/tracking` (C), chat de proyecto vive como
pestaña dentro de la página de proyecto (B), sin link nuevo de sidebar.

---

## 3. Reparto por dominio

| Conv | Nombre | Dominio | Tablas nuevas |
|------|--------|---------|---------------|
| **A** | Shell + Calendario | Sidebar, layout, home, Google Calendar | `calendar_events` (cache, opcional) |
| **B** | Colaboración | Chat de proyecto, modal de tareas, adjuntos, menciones | `project_messages`, `task_attachments`, `task_mentions` |
| **C** | Métricas + Pulido | Time tracking, scores/CV, purga de emojis restante | `time_entries` |

Detalle exclusivo de archivos en `01-CONV-A.md`, `02-CONV-B.md`, `03-CONV-C.md`.

---

## 4. Reglas duras (aplican a las 3)

- **NUNCA** guiones largos (— / –). Usar punto, coma, paréntesis o reformular.
- **NUNCA** emojis en UI. Solo iconos `lucide-react`.
- Español visible con **ñ y tildes** correctas ("campaña", "diseño").
- Aditivo siempre: no romper superficies vivas (Scrum, Marketplace, Chat equipo).
- Seguridad: auth + re-chequeo de membresía + zod strict + rate limit en cada API.
- Tokens de Google y secretos: solo server-side, nunca al cliente.
- Al terminar: `npx tsc --noEmit` = `EXIT: 0` antes de avisar al deployer.

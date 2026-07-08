# CONV B — Chat de proyectos + Modal de tareas (adjuntos + menciones)

Trabajas sobre `C:\Users\GRIZZLY\Desktop\TSKR` (Next.js 14 App Router + Supabase).
Lee primero `docs/coordination/00-AUDITORIA-Y-PLAN.md`. **NO despliegas**: al final
avisas al deployer. Reglas duras: sin guiones largos, sin emojis (iconos lucide),
ñ/tildes correctas, aditivo, seguridad en cada API.

## Tu objetivo
Un **chat por proyecto** (realtime) y un **modal de tareas mucho más estético** con
**adjuntos** y **@menciones** de compañeros que notifican.

## Archivos que POSEES (nadie más los toca)
- **NUEVO** `src/components/chat/ProjectChat.tsx`
- `src/app/(app)/w/[workspaceSlug]/t/[teamSlug]/p/[projectSlug]/page.tsx` (pestañas)
- `src/app/(app)/w/[workspaceSlug]/projects/[projectId]/**` (ManageProject: agrega chat)
- **NUEVO** `src/app/api/projects/[projectId]/messages/route.ts`
- `src/components/tasks/TaskDetailPanel.tsx` y componentes de tareas asociados
  (`ChecklistSection`, etc. — todo lo de `src/components/tasks/**`)
- **NUEVO** `src/app/api/tasks/[taskId]/attachments/**`
- **NUEVO** `src/app/api/tasks/[taskId]/mentions/**`
- **DUEÑO ÚNICO de `src/lib/activity.ts`** (agrega tipos append-only; A/C te los piden)

## Archivos PROHIBIDOS (de otros)
`src/components/sidebar/**`, `w/[slug]/layout.tsx`, `w/[slug]/page.tsx`, `calendar/**`,
`tracking/**`, `my-tasks/**`, `cv/**`, `src/lib/supabase/types.ts` (usa `as any`).

## Migraciones (Supabase MCP `apply_migration`, NO por deploy)
Espeja la tabla `messages` existente. Usa `(admin as any)` en el código.
```sql
-- project_messages (chat por proyecto)
CREATE TABLE project_messages (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  author_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE project_messages ENABLE ROW LEVEL SECURITY;
CREATE INDEX pm_project_idx ON project_messages(project_id, created_at);
-- SELECT: miembros del proyecto o de su workspace (sigue el patrón de messages)

-- task_attachments
CREATE TABLE task_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name         text NOT NULL,
  url          text NOT NULL,
  mime_type    text,
  size         bigint,
  uploaded_by  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;

-- task_mentions
CREATE TABLE task_mentions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  mentioned_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  mentioned_by   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  source         text NOT NULL DEFAULT 'comment', -- comment | description
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE task_mentions ENABLE ROW LEVEL SECURITY;
```
Storage: reusa el bucket `attachments` con path `task/{taskId}/{uuid}-{filename}`,
o crea bucket `task-files`. Sube con signed upload; sirve con signed URL.

## Trabajo 1 — Chat de proyecto
- `POST /api/projects/[projectId]/messages` (espeja `api/messages/route.ts`):
  rate limit, auth, verifica que el user sea miembro del proyecto (o de su workspace,
  según la regla que uses; consistente con lectura), inserta en `project_messages`.
- `GET` historial (últimos 100) lo hace el server component con admin client.
- `ProjectChat.tsx`: clona `TeamChat.tsx` (realtime sobre `project_messages`,
  `postgres_changes` INSERT filtrado por `project_id`). Resuelve autor con members.
- Móntalo como **pestaña "Chat"** en la página de proyecto y en ManageProject.

## Trabajo 2 — Modal de tareas estético + adjuntos + menciones
- Rediseña `TaskDetailPanel` con mejor jerarquía (encabezado con proyecto+estado,
  cuerpo en 2 columnas: contenido | metadatos), transiciones suaves, iconos lucide.
  No rompas props ni el guardado existente (es superficie viva).
- **Adjuntos**: sección con drag-and-drop, lista con nombre/tamaño/preview de imagen,
  botón borrar (solo quien subió o manager). Valida en el server: tamaño <= 25MB,
  allowlist de mime, path scoped por task. Signed URLs.
- **@menciones**: en comentarios y descripción, autocompletar con miembros del
  proyecto/equipo (no cualquiera). Al guardar, inserta en `task_mentions` y crea
  `notifications` tipo `TASK_MENTIONED` (agrega el tipo en `activity.ts`).
  El notificado ve la mención en Bandeja.

### Seguridad
- Anti-IDOR en TODAS las rutas: el `taskId`/`projectId` debe pertenecer al workspace
  del user y el user debe ser miembro. Nunca confíes en el `project_id` del body.
- Menciones solo a miembros reales. Adjuntos: verifica pertenencia antes de firmar URL.
- zod strict + `applyRateLimit`.

## Cierre
1. Aplica las migraciones con Supabase MCP `apply_migration`.
2. `cd "C:\Users\GRIZZLY\Desktop\TSKR" && npx tsc --noEmit` → `EXIT: 0`.
3. Entrada en `docs/COLAB-CHANGELOG.md`.
4. Avisa: "Conv B listo" + archivos + migraciones aplicadas + tipos de notificación
   nuevos que agregaste a `activity.ts`.

# CONV C — Time tracking + Scores/CV + Pulido (emojis)

Trabajas sobre `C:\Users\GRIZZLY\Desktop\TSKR` (Next.js 14 App Router + Supabase).
Lee primero `docs/coordination/00-AUDITORIA-Y-PLAN.md`. **NO despliegas**: al final
avisas al deployer. Reglas duras: sin guiones largos, sin emojis (iconos lucide),
ñ/tildes correctas, aditivo, seguridad en cada API.

## Tu objetivo
Que el **tracking de tiempo funcione bien**, que los **scores/calificaciones** se vean
con jerarquía premium, y dejar la UI **sin emojis** (iconos lucide).

## Archivos que POSEES (nadie más los toca)
- **NUEVO** `src/app/(app)/w/[workspaceSlug]/tracking/**` (timesheet + reportes)
- `src/app/(app)/w/[workspaceSlug]/my-tasks/**` (agrega timer por fila)
- **NUEVO** `src/components/tracking/TaskTimer.tsx` y `TimerWidget.tsx`
- **NUEVO** `src/app/api/time-entries/**`
- **Scores/CV**: `src/app/(app)/w/[workspaceSlug]/cv/[profileId]/**`,
  `src/app/(app)/settings/profile/**`, `src/app/api/cv/[profileId]/route.ts`
- **Purga de emojis** SOLO en archivos que nadie más posee: `notes/**`,
  `whiteboards/**`, `inbox/**`, `t/[teamSlug]/page.tsx` (overview),
  `projects/new` / `NewProjectForm`, componentes sueltos con emoji.

## Archivos PROHIBIDOS (de otros)
`src/components/sidebar/**`, `w/[slug]/layout.tsx`, `w/[slug]/page.tsx`, `calendar/**`,
`chat/**`, `TaskDetailPanel` y `src/components/tasks/**`, `projects/[projectId]/**`,
`src/lib/activity.ts` (si necesitas un tipo, pídelo a Conv B),
`src/lib/supabase/types.ts` (usa `as any`).

## Migración (Supabase MCP `apply_migration`, NO por deploy)
```sql
CREATE TABLE time_entries (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id      uuid REFERENCES tasks(id) ON DELETE CASCADE,
  project_id   uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  profile_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at   timestamptz NOT NULL,
  ended_at     timestamptz,               -- null = timer corriendo
  duration_sec integer,                   -- se llena al parar
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
CREATE INDEX te_profile_idx ON time_entries(profile_id, started_at);
CREATE UNIQUE INDEX te_one_running ON time_entries(profile_id) WHERE ended_at IS NULL;
-- SELECT: dueño o manager/admin del proyecto; INSERT/UPDATE: solo dueño
```
El índice `te_one_running` garantiza **un solo timer activo por persona**.

## Trabajo 1 — Time tracking
- `POST /api/time-entries/start` `{ task_id }` → crea entry corriendo (falla 409 si ya
  hay uno; el índice único lo respalda). `POST .../stop` → setea `ended_at` +
  `duration_sec`. `POST /api/time-entries` (manual) `{ task_id, started_at, ended_at }`.
  `GET /api/time-entries?from=&to=&project_id=`. `PATCH/DELETE` solo del propio dueño.
- `TaskTimer.tsx`: botón play/stop (iconos lucide Play/Square) + cronómetro vivo.
  Móntalo en las filas de `my-tasks`. `TimerWidget` opcional (barra flotante con el
  timer activo).
- Página `/w/[slug]/tracking`: timesheet (hoy/semana), totales por proyecto y por día,
  entradas editables. Barras/tarjetas con `recharts` (ya se usa en el dashboard Scrum).

### Seguridad tracking
- Anti-IDOR: el `task_id` debe pertenecer al workspace del user y ser miembro.
- Un user solo lee/edita sus entries; managers ven las del proyecto (read-only).
- zod strict + `applyRateLimit`.

## Trabajo 2 — Scores / CV premium
- Pule `cv/[profileId]` y su render de reputación: tarjeta de score global (promedio
  de los 4 ejes), barras por eje (colaboración/calidad/confiabilidad/comunicación),
  badge de nivel, conteo de reviews. **Respeta k-anonimato: solo muestra promedios si
  hay >=3 reviews** (ya está en la lógica; no lo rompas). Iconos lucide, sin emojis.
- `settings/profile`: mantén la galería de avatares (husky solo admin). Pule layout.
- No cambies el contrato de `project_reviews` ni de `profile_reputation()`; es superficie
  viva compartida con el Marketplace.

## Trabajo 3 — Purga de emojis
Reemplaza cualquier emoji por icono lucide equivalente SOLO en tus archivos permitidos.
No toques archivos de A/B aunque tengan emojis (ellos los purgan en los suyos).

## Cierre
1. Aplica la migración con Supabase MCP `apply_migration`.
2. `cd "C:\Users\GRIZZLY\Desktop\TSKR" && npx tsc --noEmit` → `EXIT: 0`.
3. Entrada en `docs/COLAB-CHANGELOG.md`.
4. Avisa: "Conv C listo" + archivos + migración aplicada.

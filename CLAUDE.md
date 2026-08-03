# WLO (Work OS): Contexto del Proyecto

> Este archivo es leído automáticamente por Claude en cada sesión.
> Mantenerlo actualizado es OBLIGATORIO al terminar cada bloque de trabajo.

---

## REGLAS DURAS (leer antes de escribir una sola línea)

Esto no es una lista de preferencias. Cada regla está aquí porque ya se rompió
algo, o porque estuvo a punto de romperse y quedó documentado. WLO está **en
producción** (`wlo.vercel.app`) con gente usándolo todos los días: no hay una
ventana de "todavía no importa".

### 1. No se toca la autorización sin entender qué protege

- `createAdminClient()` **se salta el RLS**. En cualquier ruta que lo use, el
  único candado que existe es el `if` que está escrito ahí mismo. Borrar ese
  `if` no da error, no rompe el build, no ensucia un log: simplemente abre la
  puerta. Ya pasó una vez con `/api/flows/[flowId]/members`, que devolvía el
  directorio completo con correos a cualquier persona autenticada de cualquier
  inquilino.
- La autorización de flujos vive en `resolveFlowAccess` (`src/lib/flows/access.ts`).
  Es la única fuente de verdad. No se replica la lógica en la ruta.
- Un permiso de "solo ver" es un **techo**, no un piso: nunca puede subir a
  edición porque la visibilidad general lo permitiría.
- Cualquier valor desconocido degrada al lado seguro (`view`, `none`), nunca a
  escritura.

### 2. Los tripwires no se "arreglan" borrándolos

Los archivos de `tests/` en su mayoría no prueban funcionalidad, prueban
**invariantes**: leen el código fuente con regex y fallan si una garantía
desaparece. Si uno se pone rojo, la respuesta correcta es casi siempre reponer lo
que se quitó, no aflojar el test. Aflojar el test es exactamente el fallo que
estos archivos existen para evitar: un rojo que dejó de significar que algo está
mal.

Corren solos en cada push y en cada PR (`.github/workflows/ci.yml`), y `master`
está protegida exigiendo que pasen. No es opcional ni depende de que alguien se
acuerde.

Si de verdad la invariante cambió a propósito, se cambia el test **y se explica
en el commit por qué la garantía vieja ya no aplica**.

### 3. Prohibido en el editor de flujos

`src/app/(app)/w/[workspaceSlug]/flows/[flowId]/FlowEditor.tsx`:

- **No quitar los guardas `readOnly`.** Hay ~20 y cada uno impide que alguien con
  acceso de solo lectura mute el flujo de otro.
- **No quitar `sanitizeRichText`.** El nodo `html` guarda markup de una persona y
  lo pinta otra. La CSP del proyecto trae `'unsafe-inline'`, así que sanear al
  pintar es la única barrera real contra XSS almacenado.

### 4. Nada fuera del alcance del proyecto

- El código de la app vive en `src/`. **No se crean directorios de código nuevos
  en la raíz** (`plugins/`, `packages/`, `modules/`, etc.). Hay un tripwire que
  falla si aparecen.
- **No hay sistema de plugins y no se va a construir uno.** Vercel corre en un
  filesystem efímero de solo lectura: un cargador de plugins que escribe a disco
  no puede funcionar ahí, y uno que ejecuta código subido es un agujero de
  seguridad, no una feature.
- **Nunca escribir al filesystem en runtime** (`fs.writeFile`, `mkdir`, etc.).
  Los archivos van a Supabase Storage.
- **Nunca construir una ruta de disco concatenando entrada del usuario**
  (`path.join(dir, params.algo)`). Eso es path traversal.
- Si una tarea parece pedir algo de esta lista, **parar y preguntar**, no
  improvisar una versión "segura".

### 5. Antes de subir nada

```bash
npm run type-check     # tsc --noEmit
npm test               # vitest run  (deben pasar TODOS, sin excepcion)
npm run build          # el build de Vercel no debe enterarse de nada nuevo
```

Si `npm test` estaba verde antes de tu cambio y queda rojo después, tu cambio no
está listo. No se sube "para que CI lo diga".

### 6. Git

- **Nunca hacer push a `master`.** `master` autodespliega a producción.
- Se trabaja en la rama asignada y se abre PR.
- Commits en español, explicando el **porqué**, no el qué.

### 7. Idioma y estilo

- **Prohibido el guion largo (— y –) en cualquier archivo**: código, comentarios,
  strings, commits, documentación. Se reemplaza con punto, coma, dos puntos,
  paréntesis, o reformulando.
- El texto en español **visible al usuario** lleva ñ y tildes correctas:
  "campaña", "diseño", "configuración". No "campana" ni "diseno".
- Íconos SVG (lucide), no emojis, en la interfaz.

---

## Stack (bloqueado)

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 14 App Router |
| Hosting | Vercel |
| DB / Auth / Storage / Realtime | Supabase (PostgreSQL) |
| Auth provider | Google OAuth ONLY, sin TOTP/2FA |
| Editor rico | Tiptap v2 |
| Pizarra | Excalidraw (lazy-loaded) |
| UI | shadcn/ui + Tailwind CSS |
| AI writing | Google Gemini 1.5 Flash via Vercel AI SDK |
| Forms | React Hook Form + Zod |
| Server state | TanStack Query v5 |
| Global state | Zustand |
| Drag & Drop | @dnd-kit/core + @dnd-kit/sortable |
| Ordenación | fractional-indexing |
| Email | Resend + React Email |
| Rate limiting | @upstash/ratelimit + @vercel/kv |
| Error tracking | Sentry (@sentry/nextjs) |

---

## Jerarquía de datos

```
Organization
  └── Workspaces (múltiples por org, uno por equipo/área)
        ├── workspace_members (roles por workspace)
        └── Teams
              └── Projects
                    ├── project_statuses (custom, por proyecto)
                    └── Tasks
                          ├── task_assignees
                          ├── task_comments (Tiptap)
                          ├── task_checklists / items
                          ├── task_dependencies
                          └── task_labels
```

---

## Visibilidad de archivos

Todo recurso (attachments, notes, whiteboards) tiene:
```
visibility: enum('private', 'project', 'team', 'workspace')
```
- `private` → solo el creador
- `project` → miembros del proyecto
- `team` → miembros del team
- `workspace` → todos en el workspace

Los attachments tienen `workspace_id`, `project_id`, `team_id` denormalizados
para que el RLS funcione sin joins costosos.

---

## Roles

```
Org level (profiles.org_role):   owner | admin | member
Workspace level (workspace_members.role): admin | manager | member | viewer
Project level (project_members.role):     manager | member | viewer
```

Herencia: org owner/admin ven todo. Roles de proyecto nunca superan el org role.

---

## Reglas de egress (CRÍTICAS)

1. NUNCA `select *`, siempre columnas explícitas
2. NUNCA `task.description` en queries de lista, solo en detalle
3. NUNCA almacenar avatares en Storage, usar URL de Google CDN
4. NUNCA copiar archivos de Drive, solo metadata (id, nombre, url, thumbnail)
5. NUNCA suscribirse a tablas completas en Realtime, siempre `filter: column=eq.value`
6. SIEMPRE paginar (50 items, cursor-based)
7. SIEMPRE lazy-load de Excalidraw y Tiptap
8. SIEMPRE comprimir imágenes client-side antes de subir
9. Límites Storage: imágenes 2MB, docs/pdf 20MB
10. TanStack Query stale times: projects 5min, tasks 2min, notifications 30s

---

## Seguridad

- Google OAuth + restricción por dominio en `src/middleware.ts`. La lista viene de
  `ALLOWED_EMAIL_DOMAINS` (varios, separados por coma) con respaldo en
  `ALLOWED_EMAIL_DOMAIN`. No está quemada en el código.
- JWT Custom Claims: `{ org_id, org_role, workspace_ids[] }`
- RLS en TODAS las tablas sin excepción
- Función helper: `auth_org_id()` en Postgres para evitar subqueries
- Rate limiting: `applyRateLimit` en las rutas. Si un `route.ts` lo pierde, hay
  tripwires que lo detectan. Se le pasa siempre el identificador del usuario.
- Zod validation en TODOS los Route Handlers antes de tocar DB
- Security headers: CSP, X-Frame-Options, etc. en `next.config.mjs`
- La CSP trae `'unsafe-inline'`. Consecuencia directa: **todo HTML de usuario se
  sanea al pintarlo**, sin excepción.
- Variables de entorno: NUNCA `NEXT_PUBLIC_` para secrets

---

## Rutas de navegación

```
/                                    → redirect a último workspace
/w/[workspaceSlug]/                  → dashboard del workspace
/w/[workspaceSlug]/projects/         → lista de proyectos
/w/[workspaceSlug]/projects/[id]/    → proyecto (List view default)
/w/[workspaceSlug]/projects/[id]/board/
/w/[workspaceSlug]/projects/[id]/calendar/
/w/[workspaceSlug]/my-tasks/         → mis tareas cross-proyecto
/w/[workspaceSlug]/inbox/            → notificaciones
/w/[workspaceSlug]/notes/            → notas del workspace
/w/[workspaceSlug]/notes/[id]/
/w/[workspaceSlug]/whiteboards/[id]/
/w/[workspaceSlug]/flows/[flowId]/    → editor de flujos
/w/[workspaceSlug]/marketplace/       → catálogo de herramientas (todo el equipo)
/w/[workspaceSlug]/guia/              → onboarding
/auth/login/
/auth/unauthorized/
```

Configuración: **cuelga del workspace**, no de la raíz. El gate de admin lo pone
el layout de `/settings`, no cada página. Aun así cada panel recibe `isAdmin` y
apaga sus botones: la pantalla no debe asumir quién la gateó, y el candado que
manda de verdad está en la ruta `/api`.

```
/w/[workspaceSlug]/settings/                → general
/w/[workspaceSlug]/settings/members/        · /invites/ · /teams/ · /departments/
/w/[workspaceSlug]/settings/accesos/        → qué ve cada persona
/w/[workspaceSlug]/settings/herramientas/   → mismo panel que /marketplace
/w/[workspaceSlug]/settings/conectores/     · /academia/ · /performance/ · /lobby/
```

---

## AI Features

Proveedor: Google Gemini 1.5 Flash (gratis: 15 RPM, 1M tokens/día)
Integración: `@ai-sdk/google` + Vercel AI SDK streaming

Features por fase:
- Fase 1: Mejorar texto, corregir gramática, hacer conciso (en TaskDetail editor)
- Fase 2: Resumir nota, expandir idea, cambiar tono (en Notes)
- Fase 3: Generar subtareas desde título, generar descripción de tarea

---

## Estado actual del código

**El proyecto está EN PRODUCCIÓN.** Esta sección decía "Fase 0 en progreso" con
el esquema inicial sin crear, y eso llevaba a cualquier IA que leyera el archivo
a intentar construir de cero cosas que existen desde hace meses. Corregido el
2026-08-02.

Lo que hay hoy:

| | |
|---|---|
| Producción | `wlo.vercel.app` (autodespliega con push a `master`) |
| Migraciones | 68 en `supabase/migrations/` |
| Tripwires | 78 archivos en `tests/`, 346 tests (al 2026-08-02) |
| Fases | F0 a F9 completas + Nivel 1 (SOPs) desplegado |

Construido y en uso: autenticación Google + restricción por dominio, RLS en todas
las tablas, workspaces y equipos, proyectos y tareas (lista, tablero, calendario),
notas Tiptap, pizarras Excalidraw, documentos por departamento, flujos
(React Flow), onboarding, academia, panel de administración, SOPs con acuse y
cron, marketplace de herramientas, reporte diario, chat de equipo, tracking.

### Al empezar una sesión

No asumir el estado por este archivo. Verificarlo:

```bash
git log --oneline -10
npm test
```

---

## Puntos minados conocidos (no descubrirlos otra vez)

**Migraciones.** Nunca crear una FK que cierre un ciclo entre tablas ya
relacionadas, ni una policy RLS con subquery a su propia tabla. Lo primero
produce HTTP 300 de PostgREST en **todos** los embeds; lo segundo, error 42P17.
El síntoma en ambos casos es "Página no encontrada" para **todo el mundo** justo
después de una migración. Si eso pasa, revisar los logs de la API buscando 300 o
42P17 antes de tocar cualquier otra cosa.

**Marketplace.** `effectiveHidden()` esconde toda feature instalable que no esté
en `installed_features`. Para volver instalable una feature ya en uso: primero se
rellena la columna para los workspaces existentes, después se marca `installable`.
Al revés, la pantalla desaparece para quien ya la estaba usando.

**Rutas `/api` y RLS.** Las rutas usan service role y se saltan el RLS. Por eso
el filtro de "cada quien ve lo suyo" va **en la consulta**, nunca al pintar en el
cliente. Un filtro en el componente es decoración: la respuesta ya salió del
servidor con todo adentro.

**Permisos.** Un `modules` explícito y no vacío en la fila del usuario **pisa el
preset completo del rol**. Cambiar el preset no le da el módulo a quien tiene
override; hay que tocar su fila.

---

## Convenciones de código

- Server Components por defecto, `'use client'` solo para interactividad
- Route Handlers en `src/app/api/[recurso]/route.ts`
- Validación Zod antes de cualquier operación DB en Route Handlers
- Un hook de TanStack Query por recurso en `src/hooks/`
- Activity log: llamar `logActivity()` en cada mutación importante
- Errores: siempre retornar `{ error: string }` con status code correcto
- Validar el UUID de todo segmento dinámico (`isUuid()`) antes de consultar
- Comentar el **porqué**, no el qué. Un comentario que repite el código es ruido;
  uno que dice qué se rompe si lo quitas es lo que evita que alguien lo quite.

---

## Skills disponibles (slash commands)

```
/full-stack        → contexto completo + guías de desarrollo
/gen-migration     → generar SQL migration con RLS e índices
/gen-component     → generar componente React siguiendo patrones del proyecto
/gen-api-route     → generar Route Handler con Zod + Supabase + activity log
/check-egress      → auditar queries y componentes por problemas de egress
/spec              → mostrar resumen del spec técnico completo
```

---

## Links importantes

- PRD: `prd_formal_work_os_interno_google_native.md` (en Desktop)
- Memoria del proyecto: `~/.claude/projects/C--Users-GRIZZLY-Desktop-TSKR/memory/`
- Spec técnico: `CLAUDE.md` (este archivo)

---

## Si algo de este archivo no coincide con el código

Gana el código, y **se corrige este archivo en el mismo commit**. Un contexto
desactualizado es peor que no tener contexto: la IA que lo lee no duda, actúa.
Esta sección existe porque el archivo pasó meses diciendo que el proyecto estaba
en Fase 0 con el esquema sin crear.

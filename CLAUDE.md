# Work OS — Contexto del Proyecto

> Este archivo es leído automáticamente por Claude en cada sesión.
> Mantenerlo actualizado es OBLIGATORIO al terminar cada bloque de trabajo.

---

## Stack (bloqueado)

| Capa | Tecnología |
|------|-----------|
| Framework | Next.js 14 App Router |
| Hosting | Vercel |
| DB / Auth / Storage / Realtime | Supabase (PostgreSQL) |
| Auth provider | Google OAuth ONLY — sin TOTP/2FA |
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
  └── Workspaces (múltiples por org — uno por equipo/área)
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

1. NUNCA `select *` — siempre columnas explícitas
2. NUNCA `task.description` en queries de lista — solo en detalle
3. NUNCA almacenar avatares en Storage — usar URL de Google CDN
4. NUNCA copiar archivos de Drive — solo metadata (id, nombre, url, thumbnail)
5. NUNCA suscribirse a tablas completas en Realtime — siempre `filter: column=eq.value`
6. SIEMPRE paginar (50 items, cursor-based)
7. SIEMPRE lazy-load de Excalidraw y Tiptap
8. SIEMPRE comprimir imágenes client-side antes de subir
9. Límites Storage: imágenes 2MB, docs/pdf 20MB
10. TanStack Query stale times: projects 5min, tasks 2min, notifications 30s

---

## Seguridad

- Google OAuth + domain restriction (`@tudominio.com` only) en middleware
- JWT Custom Claims: `{ org_id, org_role, workspace_ids[] }`
- RLS en TODAS las tablas sin excepción
- Función helper: `auth_org_id()` en Postgres para evitar subqueries
- Rate limiting en Edge: 100 req/min general, 20/min AI endpoints
- Zod validation en TODOS los Route Handlers antes de tocar DB
- Security headers: CSP, X-Frame-Options, etc. en next.config.ts
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
/settings/profile/
/settings/workspaces/
/settings/members/
/auth/login/
/auth/unauthorized/
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

### Fase 0 — En progreso
> ⚠️ Los primeros 5 ítems son BLOQUEANTES — nada más funciona sin ellos

- [ ] `supabase/migrations/0001_initial_schema.sql` — todas las tablas + RLS + índices + triggers
- [ ] Función `auth_org_id()` en Postgres — usada por TODAS las policies RLS
- [ ] JWT Custom Claims hook — popula `{ org_id, org_role, workspace_ids[] }` post-OAuth
- [ ] `src/lib/activity.ts` — función `logActivity()` usada por todos los Route Handlers
- [ ] `src/middleware.ts` — auth check + domain restriction `@tudominio.com` + rate limit
- [ ] Next.js scaffold + shadcn/ui + Tailwind
- [ ] Google OAuth configurado (Google Cloud Console)
- [ ] Security headers en `next.config.ts`
- [ ] CI/CD: GitHub Actions + Vercel Preview Deployments

### Últimos archivos creados
_(actualizar aquí después de cada sesión)_

---

## Convenciones de código

- Server Components por defecto, `'use client'` solo para interactividad
- Route Handlers en `src/app/api/[recurso]/route.ts`
- Validación Zod antes de cualquier operación DB en Route Handlers
- Un hook de TanStack Query por recurso en `src/hooks/`
- Activity log: llamar `logActivity()` en cada mutación importante
- Errores: siempre retornar `{ error: string }` con status code correcto

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

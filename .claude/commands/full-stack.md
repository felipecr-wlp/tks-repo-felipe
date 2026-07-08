# Full Stack Development — Work OS

Eres el desarrollador full stack principal de este proyecto Work OS (reemplazo de ClickUp, Google-native).

## Tu contexto siempre activo

**Stack:** Next.js 14 App Router · Supabase · shadcn/ui · Tiptap v2 · Excalidraw · Gemini AI · Vercel

**Jerarquía:** Organization → Workspaces → Teams → Projects → Tasks

**Auth:** Google OAuth ONLY. Domain restriction en middleware. Sin TOTP.

**Visibilidad de recursos:** `private | project | team | workspace` en notes, attachments, whiteboards.

## Reglas que NUNCA rompes

### Egress
- NUNCA `select *` — siempre columnas explícitas
- NUNCA `task.description` en queries de lista
- NUNCA avatares en Supabase Storage — URL de Google CDN
- NUNCA archivos de Drive en Storage — solo metadata
- NUNCA Realtime sin filtro de columna (`filter: project_id=eq.${id}`)
- SIEMPRE paginar (50 items, cursor-based con `position`)
- SIEMPRE lazy-load de Excalidraw (`dynamic(() => import(...), { ssr: false }}`)
- SIEMPRE comprimir imágenes antes de subir (2MB max para imágenes, 20MB para docs)

### Seguridad
- SIEMPRE RLS en tablas nuevas — nunca crear tabla sin policy
- SIEMPRE Zod en Route Handlers antes de tocar DB
- NUNCA `NEXT_PUBLIC_` para secrets o service role keys
- SIEMPRE verificar dominio en middleware
- SIEMPRE rate limit en endpoints de AI (20/min)

### Código
- Server Components por defecto — `'use client'` solo cuando hay interactividad
- Un archivo por responsabilidad — no mezclar UI con lógica de negocio
- TanStack Query para server state — Zustand solo para UI state
- `logActivity()` en toda mutación importante
- Responder siempre `{ error: string }` con status correcto en errores

## Patrones estándar

### Route Handler
```typescript
// src/app/api/[resource]/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logActivity } from '@/lib/activity'

const schema = z.object({ /* ... */ })

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })

  const { data, error } = await supabase
    .from('table')
    .insert({ ...parsed.data, organization_id: user.app_metadata.org_id })
    .select('id, title, created_at') // columnas explícitas
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logActivity({ verb: 'resource.created', entityType: 'resource', entityId: data.id, actorId: user.id })

  return NextResponse.json(data, { status: 201 })
}
```

### TanStack Query hook
```typescript
// src/hooks/useTasks.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export function useTasks(projectId: string) {
  return useQuery({
    queryKey: ['tasks', projectId],
    queryFn: () => fetchTasks(projectId),
    staleTime: 2 * 60 * 1000, // 2 min
    enabled: !!projectId,
  })
}
```

### Supabase query (lista — sin description)
```typescript
const { data } = await supabase
  .from('tasks')
  .select(`
    id, title, priority, status_id, due_date, position,
    task_assignees ( profile_id, profiles ( full_name, avatar_url ) ),
    task_labels ( labels ( name, color ) )
  `)
  .eq('project_id', projectId)
  .eq('is_archived', false)
  .order('position')
  .limit(50)
// NUNCA incluir 'description' en queries de lista
```

### Supabase Realtime (siempre filtrado)
```typescript
const channel = supabase
  .channel(`tasks:${projectId}`)
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'tasks',
    filter: `project_id=eq.${projectId}` // filter en servidor
  }, handler)
  .subscribe()

return () => supabase.removeChannel(channel) // cleanup siempre
```

## Al generar código siempre incluyes:
1. TypeScript estricto — nunca `any` en código de dominio
2. Error handling en Route Handlers
3. Loading/error states en componentes
4. Cleanup de suscripciones Realtime
5. Comentario indicando el propósito del archivo

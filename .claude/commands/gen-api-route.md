# Skill: Generar API Route Handler

Genera Route Handlers de Next.js 14 App Router para el proyecto Work OS.

## Argumento
$ARGUMENTS — recurso y operación (ej: "tasks CRUD" o "notes GET+POST" o "ai/improve-text POST")

## Plantilla completa (CRUD)

```typescript
// src/app/api/[recurso]/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logActivity } from '@/lib/activity'

// ── Schemas de validación ───────────────────────────────────────────
const createSchema = z.object({
  title:      z.string().min(1).max(500).trim(),
  // ... campos del recurso
  project_id: z.string().uuid(),
})

const updateSchema = createSchema.partial().extend({
  id: z.string().uuid(),
})

// ── GET /api/[recurso] ──────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const projectId = searchParams.get('project_id')
  const cursor    = searchParams.get('cursor')   // cursor-based pagination
  const limit     = 50

  let query = supabase
    .from('[tabla]')
    .select(`
      id, title, priority, status_id, due_date, position, created_at
    `) // columnas explícitas — NUNCA select *
    .eq('organization_id', user.app_metadata.org_id)
    .eq('is_archived', false)
    .order('position')
    .limit(limit)

  if (projectId) query = query.eq('project_id', projectId)
  if (cursor)    query = query.gt('position', parseFloat(cursor))

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    data,
    nextCursor: data.length === limit ? data[data.length - 1].position : null,
  })
}

// ── POST /api/[recurso] ─────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('[tabla]')
    .insert({
      ...parsed.data,
      organization_id: user.app_metadata.org_id,
      created_by: user.id,
    })
    .select('id, title, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logActivity({
    verb: '[recurso].created',
    entityType: '[recurso]',
    entityId: data.id,
    entityTitle: data.title,
    actorId: user.id,
    orgId: user.app_metadata.org_id,
  })

  return NextResponse.json(data, { status: 201 })
}
```

```typescript
// src/app/api/[recurso]/[id]/route.ts
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { logActivity } from '@/lib/activity'

const updateSchema = z.object({
  title: z.string().min(1).max(500).trim().optional(),
  // ... campos actualizables
})

// ── PATCH /api/[recurso]/[id] ───────────────────────────────────────
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const parsed = updateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('[tabla]')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('organization_id', user.app_metadata.org_id) // RLS extra layer
    .select('id, title, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logActivity({
    verb: '[recurso].updated',
    entityType: '[recurso]',
    entityId: data.id,
    entityTitle: data.title,
    actorId: user.id,
    orgId: user.app_metadata.org_id,
    metadata: parsed.data,
  })

  return NextResponse.json(data)
}

// ── DELETE /api/[recurso]/[id] ──────────────────────────────────────
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Soft delete — nunca borrado permanente desde el cliente
  const { error } = await supabase
    .from('[tabla]')
    .update({ is_archived: true })
    .eq('id', params.id)
    .eq('organization_id', user.app_metadata.org_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return new NextResponse(null, { status: 204 })
}
```

## Plantilla para AI endpoint (con streaming)

```typescript
// src/app/api/ai/[action]/route.ts
import { createClient } from '@/lib/supabase/server'
import { streamText } from 'ai'
import { geminiFlash } from '@/lib/ai/client'
import { NextRequest } from 'next/server'
import { z } from 'zod'

const schema = z.object({
  text:   z.string().min(1).max(5000),
  action: z.enum(['improve', 'grammar', 'concise', 'summarize', 'expand']),
})

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const body = await req.json()
  const parsed = schema.safeParse(body)
  if (!parsed.success) return new Response('Bad Request', { status: 400 })

  const prompts: Record<string, string> = {
    improve:   `Mejora la redacción del siguiente texto manteniendo el significado. Solo el texto mejorado:\n\n${parsed.data.text}`,
    grammar:   `Corrige errores gramaticales y ortográficos. Solo el texto corregido:\n\n${parsed.data.text}`,
    concise:   `Haz este texto más conciso sin perder info importante. Solo el resultado:\n\n${parsed.data.text}`,
    summarize: `Resume en 2-3 oraciones. Solo el resumen:\n\n${parsed.data.text}`,
    expand:    `Desarrolla esta idea con más detalle. Solo el texto expandido:\n\n${parsed.data.text}`,
  }

  const result = await streamText({
    model: geminiFlash,
    prompt: prompts[parsed.data.action],
    maxTokens: 1000,
  })

  return result.toDataStreamResponse()
}
```

## Instrucciones

Al invocar `/gen-api-route [recurso] [operaciones]`, genera el/los archivos de Route Handler
con validación Zod, manejo de errores, columnas explícitas, paginación si es lista, y logActivity.

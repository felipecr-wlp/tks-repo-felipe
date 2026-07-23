/**
 * GET    /api/tasks/[taskId]/labels, etiquetas de la tarea + disponibles del proyecto
 * POST   /api/tasks/[taskId]/labels, adjunta una etiqueta (existente por labelId, o
 *        crea una nueva por {name,color} y la adjunta en un paso)
 * DELETE /api/tasks/[taskId]/labels?labelId=..., quita una etiqueta de la tarea
 *
 * Reutiliza las tablas ya presentes en la DB: `labels` (por proyecto) y
 * `task_labels` (relacion tarea-etiqueta). Aditivo, sin migracion.
 * El project_id/workspace_id se derivan en el servidor (anti-IDOR): el cliente
 * solo envia el taskId.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { checkTaskAccess } from '@/lib/task-access'
import type { Database } from '@/lib/supabase/types'

interface RouteParams {
  params: { taskId: string }
}

const HEX = /^#[0-9a-fA-F]{6}$/

const postSchema = z.union([
  z.object({ labelId: z.string().uuid() }),
  z.object({
    name: z.string().min(1).max(40).trim(),
    color: z.string().regex(HEX).optional(),
  }),
])

type LabelRow = { id: string; name: string; color: string }

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 404 ? 'Tarea no encontrada' : 'Sin acceso' },
      { status: access.status },
    )
  }

  type AttachedRow = { label: LabelRow | null }
  const { data: attachedRaw, error: attachedError } = await admin
    .from('task_labels')
    .select('label:labels ( id, name, color )')
    .eq('task_id', params.taskId) as { data: AttachedRow[] | null; error: unknown }

  if (attachedError) {
    console.error('[labels GET] attached read error:', attachedError)
    return NextResponse.json({ error: 'Error al cargar etiquetas' }, { status: 500 })
  }

  const attached = (attachedRaw ?? [])
    .map(r => r.label)
    .filter((l): l is LabelRow => l != null)

  const { data: available, error: availableError } = await admin
    .from('labels')
    .select('id, name, color')
    // access.projectId es no-nulo tras el guard !access.ok de arriba
    .eq('project_id', access.projectId!)
    .order('name', { ascending: true }) as { data: LabelRow[] | null; error: unknown }

  if (availableError) {
    console.error('[labels GET] available read error:', availableError)
    return NextResponse.json({ error: 'Error al cargar etiquetas' }, { status: 500 })
  }

  return NextResponse.json({ attached, available: available ?? [] })
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })
  }

  const admin = createAdminClient()

  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 404 ? 'Tarea no encontrada' : 'Sin acceso' },
      { status: access.status },
    )
  }

  const db = admin
  let label: LabelRow | null = null

  if ('labelId' in parsed.data) {
    // Adjuntar etiqueta existente: verificar que pertenezca al proyecto
    const { data: found } = await admin
      .from('labels')
      .select('id, name, color')
      .eq('id', parsed.data.labelId)
      // access.projectId es no-nulo tras el guard !access.ok de arriba
      .eq('project_id', access.projectId!)
      .maybeSingle() as { data: LabelRow | null; error: unknown }

    if (!found) return NextResponse.json({ error: 'Etiqueta no encontrada' }, { status: 404 })
    label = found
  } else {
    // Crear etiqueta nueva en el proyecto. Necesita workspace_id.
    type WsRow = { workspace_id: string }
    const { data: task } = await admin
      .from('tasks')
      .select('workspace_id')
      .eq('id', params.taskId)
      .maybeSingle() as { data: WsRow | null; error: unknown }

    if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

    // access.projectId es no-nulo tras el guard !access.ok de arriba
    const labelPayload = {
      project_id: access.projectId!,
      workspace_id: task.workspace_id,
      name: parsed.data.name,
      color: parsed.data.color ?? '#6b7280',
    } satisfies Database['public']['Tables']['labels']['Insert']
    const { data: created, error: createErr } = await db
      .from('labels')
      // as never: pitfall conocido de @supabase/ssr donde el parametro de escritura colapsa a never
      .insert(labelPayload as never)
      .select('id, name, color')
      .single() as { data: LabelRow | null; error: unknown }

    if (createErr || !created) {
      console.error('[task labels POST] create error:', createErr)
      return NextResponse.json({ error: 'Error al crear etiqueta' }, { status: 500 })
    }
    label = created
  }

  // Vincular a la tarea (idempotente ante duplicados)
  const { error: linkErr } = await db
    .from('task_labels')
    .upsert(
      { task_id: params.taskId, label_id: label.id },
      { onConflict: 'task_id,label_id', ignoreDuplicates: true },
    )

  if (linkErr) {
    console.error('[task labels POST] link error:', linkErr)
    return NextResponse.json({ error: 'Error al adjuntar etiqueta' }, { status: 500 })
  }

  return NextResponse.json(label, { status: 201 })
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const labelId = request.nextUrl.searchParams.get('labelId')
  if (!labelId) return NextResponse.json({ error: 'Falta labelId' }, { status: 400 })

  const admin = createAdminClient()

  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 404 ? 'Tarea no encontrada' : 'Sin acceso' },
      { status: access.status },
    )
  }

  const { error } = await admin
    .from('task_labels')
    .delete()
    .eq('task_id', params.taskId)
    .eq('label_id', labelId)

  if (error) {
    console.error('[task labels DELETE] error:', error)
    return NextResponse.json({ error: 'Error al quitar etiqueta' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

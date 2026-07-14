/**
 * GET    /api/tasks/[taskId]/relations
 *   Devuelve { relations: [{ id, type, task }] } donde `type` es el tipo DESDE la
 *   perspectiva de [taskId]: 'relates_to' | 'duplicates' | 'duplicated_by', y
 *   `task` es la OTRA tarea del enlace (id, title, status).
 * POST   /api/tasks/[taskId]/relations  { target_task_id, type }
 *   type ∈ 'relates_to' | 'duplicates' | 'duplicated_by'. Se normaliza al tipo
 *   canonico ('relates_to' | 'duplicates') invirtiendo source/target si aplica.
 * DELETE /api/tasks/[taskId]/relations?relationId=...
 *
 * Bloqueo (blocks / bloqueada por) NO vive aqui, vive en task_dependencies.
 * Anti-IDOR: checkTaskAccess valida membresia; la tarea objetivo debe pertenecer
 * al MISMO proyecto. El project_id se deriva en el servidor.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { checkTaskAccess } from '@/lib/task-access'

interface RouteParams {
  params: { taskId: string }
}

const postSchema = z.object({
  target_task_id: z.string().uuid(),
  type: z.enum(['relates_to', 'duplicates', 'duplicated_by']),
})

type RelTask = {
  id: string
  title: string
  status: { id: string; name: string; color: string | null; category: string } | null
}

const TASK_SELECT = 'id, title, status:task_statuses ( id, name, color, category )'

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 404 ? 'Tarea no encontrada' : 'Sin acceso' }, { status: access.status })
  }

  // filas donde esta tarea es el source
  type OutRow = { id: string; relation_type: string; target: RelTask | null }
  const { data: outgoing } = await admin
    .from('task_relations')
    .select(`id, relation_type, target:tasks!task_relations_target_task_id_fkey ( ${TASK_SELECT} )`)
    .eq('source_task_id', params.taskId) as { data: OutRow[] | null }

  // filas donde esta tarea es el target
  type InRow = { id: string; relation_type: string; source: RelTask | null }
  const { data: incoming } = await admin
    .from('task_relations')
    .select(`id, relation_type, source:tasks!task_relations_source_task_id_fkey ( ${TASK_SELECT} )`)
    .eq('target_task_id', params.taskId) as { data: InRow[] | null }

  const relations: { id: string; type: string; task: RelTask }[] = []
  for (const r of outgoing ?? []) {
    if (!r.target) continue
    // desde el source: relates_to -> relates_to; duplicates -> duplicates
    relations.push({ id: r.id, type: r.relation_type, task: r.target })
  }
  for (const r of incoming ?? []) {
    if (!r.source) continue
    // desde el target: relates_to -> relates_to; duplicates -> duplicated_by
    const type = r.relation_type === 'duplicates' ? 'duplicated_by' : 'relates_to'
    relations.push({ id: r.id, type, task: r.source })
  }

  return NextResponse.json({ relations })
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos invalidos' }, { status: 422 })
  const { target_task_id, type } = parsed.data

  if (target_task_id === params.taskId) {
    return NextResponse.json({ error: 'Una tarea no puede relacionarse consigo misma' }, { status: 422 })
  }

  const admin = createAdminClient()
  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 404 ? 'Tarea no encontrada' : 'Sin acceso' }, { status: access.status })
  }

  // la tarea objetivo debe existir y pertenecer al mismo proyecto
  const { data: target } = await admin
    .from('tasks')
    .select(TASK_SELECT)
    .eq('id', target_task_id)
    .eq('project_id', access.projectId)
    .maybeSingle() as { data: RelTask | null }
  if (!target) return NextResponse.json({ error: 'Tarea objetivo no encontrada' }, { status: 404 })

  // normalizar a tipo canonico + direccion
  let sourceId = params.taskId
  let targetId = target_task_id
  let relationType: 'relates_to' | 'duplicates'
  if (type === 'duplicated_by') {
    relationType = 'duplicates'
    sourceId = target_task_id  // el otro duplica a esta
    targetId = params.taskId
  } else {
    relationType = type // 'relates_to' | 'duplicates'
  }

  // para relates_to (simetrico), evitar duplicar el enlace inverso ya existente
  if (relationType === 'relates_to') {
    const { data: existing } = await admin
      .from('task_relations')
      .select('id')
      .eq('relation_type', 'relates_to')
      .eq('source_task_id', targetId)
      .eq('target_task_id', sourceId)
      .maybeSingle() as { data: { id: string } | null }
    if (existing) return NextResponse.json({ relation: { id: existing.id, type, task: target } }, { status: 200 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any
  const { data, error } = await db
    .from('task_relations')
    .upsert(
      {
        source_task_id: sourceId,
        target_task_id: targetId,
        relation_type: relationType,
        project_id: access.projectId,
        created_by: user.id,
      },
      { onConflict: 'source_task_id,target_task_id,relation_type', ignoreDuplicates: false },
    )
    .select('id')
    .single()

  if (error) {
    console.error('[task relations POST] error:', error)
    return NextResponse.json({ error: 'Error al agregar la relacion' }, { status: 500 })
  }

  return NextResponse.json({ relation: { id: data.id, type, task: target } }, { status: 201 })
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const relationId = request.nextUrl.searchParams.get('relationId')
  if (!relationId) return NextResponse.json({ error: 'Falta relationId' }, { status: 400 })

  const admin = createAdminClient()
  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 404 ? 'Tarea no encontrada' : 'Sin acceso' }, { status: access.status })
  }

  // la relacion debe tocar esta tarea y su proyecto (anti-IDOR)
  const { data: rel } = await admin
    .from('task_relations')
    .select('id, source_task_id, target_task_id, project_id')
    .eq('id', relationId)
    .maybeSingle() as { data: { id: string; source_task_id: string; target_task_id: string; project_id: string } | null }
  if (!rel || rel.project_id !== access.projectId ||
      (rel.source_task_id !== params.taskId && rel.target_task_id !== params.taskId)) {
    return NextResponse.json({ error: 'Relacion no encontrada' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('task_relations').delete().eq('id', relationId)
  if (error) {
    console.error('[task relations DELETE] error:', error)
    return NextResponse.json({ error: 'Error al quitar la relacion' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

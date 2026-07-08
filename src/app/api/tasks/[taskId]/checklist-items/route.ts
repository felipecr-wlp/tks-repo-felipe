/**
 * GET  /api/tasks/[taskId]/checklist-items — lista items de la checklist
 * POST /api/tasks/[taskId]/checklist-items — crea un nuevo item
 *
 * Para mantener UI simple, cada task tiene UNA checklist default
 * (auto-creada al insertar el primer item).
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
  title: z.string().min(1).max(500).trim(),
})

// Helper: obtener la checklist default de un task (crear si no existe)
async function getOrCreateDefaultChecklist(
  admin: ReturnType<typeof createAdminClient>,
  taskId: string
): Promise<string | null> {
  type ChecklistRow = { id: string }
  const { data: existing } = await admin
    .from('task_checklists')
    .select('id')
    .eq('task_id', taskId)
    .order('position', { ascending: true })
    .limit(1)
    .maybeSingle() as { data: ChecklistRow | null; error: unknown }

  if (existing) return existing.id

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: created, error } = await (admin as any)
    .from('task_checklists')
    .insert({ task_id: taskId, title: 'Subtareas', position: 0 })
    .select('id')
    .single() as { data: ChecklistRow | null; error: unknown }

  if (error || !created) {
    console.error('[checklist] create error:', error)
    return null
  }
  return created.id
}

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
    return NextResponse.json(
      { error: access.status === 404 ? 'Tarea no encontrada' : 'Sin acceso' },
      { status: access.status },
    )
  }

  type ItemRow = {
    id: string
    title: string
    is_checked: boolean
    position: number
    checklist_id: string
  }

  const { data: items } = await admin
    .from('task_checklist_items')
    .select('id, title, is_checked, position, checklist_id')
    .eq('task_id', params.taskId)
    .order('position', { ascending: true }) as { data: ItemRow[] | null; error: unknown }

  return NextResponse.json({ items: items ?? [] })
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
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

  // Obtener o crear checklist default
  const checklistId = await getOrCreateDefaultChecklist(admin, params.taskId)
  if (!checklistId) {
    return NextResponse.json({ error: 'Error al crear checklist' }, { status: 500 })
  }

  // Calcular position (al final)
  type CountRow = { position: number }
  const { data: lastItem } = await admin
    .from('task_checklist_items')
    .select('position')
    .eq('checklist_id', checklistId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: CountRow | null; error: unknown }

  const nextPosition = (lastItem?.position ?? -1) + 1

  type ItemInsert = {
    id: string
    title: string
    is_checked: boolean
    position: number
    checklist_id: string
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item, error } = await (admin as any)
    .from('task_checklist_items')
    .insert({
      checklist_id: checklistId,
      task_id: params.taskId,
      title: parsed.data.title,
      position: nextPosition,
    })
    .select('id, title, is_checked, position, checklist_id')
    .single() as { data: ItemInsert | null; error: unknown }

  if (error || !item) {
    console.error('[checklist-items POST] error:', error)
    return NextResponse.json({ error: 'Error al crear item' }, { status: 500 })
  }

  return NextResponse.json(item, { status: 201 })
}

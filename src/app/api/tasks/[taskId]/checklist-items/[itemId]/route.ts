/**
 * PATCH  /api/tasks/[taskId]/checklist-items/[itemId], actualiza item (toggle is_checked, edit title)
 * DELETE /api/tasks/[taskId]/checklist-items/[itemId], elimina item
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { checkTaskAccess } from '@/lib/task-access'

interface RouteParams {
  params: { taskId: string; itemId: string }
}

const patchSchema = z.object({
  title:      z.string().min(1).max(500).trim().optional(),
  is_checked: z.boolean().optional(),
}).strict()

// ── PATCH ────────────────────────────────────────────────────────────────────
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.taskId) || !isUuid(params.itemId)) {
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

  const parsed = patchSchema.safeParse(body)
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

  type ItemRow = {
    id: string
    title: string
    is_checked: boolean
    position: number
    checklist_id: string
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('task_checklist_items')
    .update({
      ...parsed.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.itemId)
    .eq('task_id', params.taskId)
    .select('id, title, is_checked, position, checklist_id')
    .single() as { data: ItemRow | null; error: unknown }

  if (error || !data) {
    return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })
  }

  return NextResponse.json(data)
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.taskId) || !isUuid(params.itemId)) {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('task_checklist_items')
    .delete()
    .eq('id', params.itemId)
    .eq('task_id', params.taskId)

  if (error) {
    return NextResponse.json({ error: 'Error al eliminar' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

/**
 * POST /api/projects/[projectId]/tasks/bulk, acciones masivas sobre tareas.
 *
 * Permite aplicar un mismo cambio a varias tareas del proyecto en una sola
 * llamada: cambiar estado, prioridad o asignado, o eliminarlas (soft-archive).
 * Es la base de las "acciones masivas" de la vista de lista (multi-seleccion).
 *
 * Anti-IDOR en dos capas:
 *  1. El usuario debe ser miembro del proyecto (projectId viene de la ruta).
 *  2. Todos los taskIds deben pertenecer a ESTE proyecto; el update/delete se
 *     hace acotado por project_id, asi ninguna tarea externa puede ser tocada
 *     aunque su id se cuele en el arreglo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { projectId: string }
}

async function assertMember(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  return !!data
}

// Una accion a la vez: o un patch de campos, o eliminar. `strict()` rechaza extras.
const bodySchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(100),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('status'), statusId: z.string().uuid() }),
    z.object({ type: z.literal('priority'), priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']) }),
    z.object({ type: z.literal('assignee'), assigneeId: z.string().uuid().nullable() }),
    z.object({ type: z.literal('delete') }),
  ]),
}).strict()

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }

  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()
  if (!(await assertMember(admin, params.projectId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const { taskIds, action } = parsed.data

  // Confirmar que las tareas pedidas son de este proyecto (defensa anti-IDOR).
  const { data: owned } = await admin
    .from('tasks')
    .select('id')
    .eq('project_id', params.projectId)
    .in('id', taskIds) as { data: { id: string }[] | null; error: unknown }

  const validIds = (owned ?? []).map(t => t.id)
  if (validIds.length === 0) {
    return NextResponse.json({ error: 'Ninguna tarea valida en este proyecto' }, { status: 404 })
  }

  // Si una nueva statusId/assigneeId se indican, validar que pertenecen al proyecto.
  if (action.type === 'status') {
    const { data: st } = await admin
      .from('task_statuses')
      .select('id')
      .eq('project_id', params.projectId)
      .eq('id', action.statusId)
      .maybeSingle() as { data: { id: string } | null; error: unknown }
    if (!st) return NextResponse.json({ error: 'Estado no valido' }, { status: 422 })
  }
  if (action.type === 'assignee' && action.assigneeId) {
    if (!(await assertMember(admin, params.projectId, action.assigneeId))) {
      return NextResponse.json({ error: 'El asignado no es miembro del proyecto' }, { status: 422 })
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any
  let error: unknown = null

  if (action.type === 'delete') {
    // Soft delete: se archiva, coherente con el borrado individual de tareas.
    const r = await db
      .from('tasks')
      .update({ is_archived: true })
      .eq('project_id', params.projectId)
      .in('id', validIds)
    error = r.error
  } else {
    const patch: Record<string, unknown> = {}
    if (action.type === 'status') patch.status_id = action.statusId
    if (action.type === 'priority') patch.priority = action.priority
    if (action.type === 'assignee') patch.assignee_id = action.assigneeId
    const r = await db
      .from('tasks')
      .update(patch)
      .eq('project_id', params.projectId)
      .in('id', validIds)
    error = r.error
  }

  if (error) {
    console.error('[tasks bulk POST] error:', error)
    return NextResponse.json({ error: 'Error al aplicar la accion masiva' }, { status: 500 })
  }

  return NextResponse.json({ success: true, affected: validIds.length })
}

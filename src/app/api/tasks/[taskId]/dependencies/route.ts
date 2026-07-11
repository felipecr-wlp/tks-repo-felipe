/**
 * GET    /api/tasks/[taskId]/dependencies
 *   Devuelve { blockers, blocking }:
 *   - blockers  = tareas que DEBEN completarse antes que esta (esta depende de ellas)
 *   - blocking  = tareas que dependen de esta (esta las bloquea)
 * POST   /api/tasks/[taskId]/dependencies  { dependsOnId }
 *   Registra que [taskId] depende de dependsOnId (dependsOnId debe cerrarse primero).
 * DELETE /api/tasks/[taskId]/dependencies?dependsOnId=...
 *   Elimina esa dependencia.
 *
 * Reutiliza la tabla ya presente en la DB `task_dependencies`
 * (task_id depende de depends_on). Aditivo, sin migracion.
 * El project_id se deriva en el servidor (anti-IDOR): el cliente solo envia
 * el taskId de la ruta y, en POST, el dependsOnId del cuerpo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { checkTaskAccess } from '@/lib/task-access'

interface RouteParams {
  params: { taskId: string }
}

const postSchema = z.object({ dependsOnId: z.string().uuid() })

type DepTask = {
  id: string
  title: string
  status: { id: string; name: string; color: string | null; category: string } | null
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

  // blockers: filas donde task_id = esta tarea; nos interesa la tarea depends_on
  type BlockerRow = { blocker: DepTask | null }
  const { data: blockersRaw } = await admin
    .from('task_dependencies')
    .select('blocker:tasks!task_dependencies_depends_on_fkey ( id, title, status:task_statuses ( id, name, color, category ) )')
    .eq('task_id', params.taskId) as { data: BlockerRow[] | null; error: unknown }

  // blocking: filas donde depends_on = esta tarea; nos interesa la tarea task_id
  type BlockingRow = { blocked: DepTask | null }
  const { data: blockingRaw } = await admin
    .from('task_dependencies')
    .select('blocked:tasks!task_dependencies_task_id_fkey ( id, title, status:task_statuses ( id, name, color, category ) )')
    .eq('depends_on', params.taskId) as { data: BlockingRow[] | null; error: unknown }

  const blockers = (blockersRaw ?? []).map(r => r.blocker).filter((t): t is DepTask => t != null)
  const blocking = (blockingRaw ?? []).map(r => r.blocked).filter((t): t is DepTask => t != null)

  return NextResponse.json({ blockers, blocking })
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
  const { dependsOnId } = parsed.data

  if (dependsOnId === params.taskId) {
    return NextResponse.json({ error: 'Una tarea no puede depender de sí misma' }, { status: 422 })
  }

  const admin = createAdminClient()

  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 404 ? 'Tarea no encontrada' : 'Sin acceso' },
      { status: access.status },
    )
  }

  // La tarea objetivo debe existir y pertenecer al MISMO proyecto (anti fuga entre proyectos)
  type TargetRow = { id: string; title: string; status: { id: string; name: string; color: string | null; category: string } | null }
  const { data: target } = await admin
    .from('tasks')
    .select('id, title, status:task_statuses ( id, name, color, category )')
    .eq('id', dependsOnId)
    .eq('project_id', access.projectId)
    .maybeSingle() as { data: TargetRow | null; error: unknown }

  if (!target) return NextResponse.json({ error: 'Tarea objetivo no encontrada' }, { status: 404 })

  // Guard de ciclo simple: si dependsOnId ya depende de esta tarea, crear el reverso
  // formaria un ciclo directo A<->B.
  type CycleRow = { id: string }
  const { data: reverse } = await admin
    .from('task_dependencies')
    .select('id')
    .eq('task_id', dependsOnId)
    .eq('depends_on', params.taskId)
    .maybeSingle() as { data: CycleRow | null; error: unknown }

  if (reverse) {
    return NextResponse.json({ error: 'Esa dependencia crearía un ciclo' }, { status: 422 })
  }

  // Insertar idempotente sobre UNIQUE (task_id, depends_on)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insErr } = await (admin as any)
    .from('task_dependencies')
    .upsert(
      { task_id: params.taskId, depends_on: dependsOnId },
      { onConflict: 'task_id,depends_on', ignoreDuplicates: true },
    )

  if (insErr) {
    console.error('[task dependencies POST] error:', insErr)
    return NextResponse.json({ error: 'Error al agregar dependencia' }, { status: 500 })
  }

  return NextResponse.json(target, { status: 201 })
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const dependsOnId = request.nextUrl.searchParams.get('dependsOnId')
  if (!dependsOnId) return NextResponse.json({ error: 'Falta dependsOnId' }, { status: 400 })

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
    .from('task_dependencies')
    .delete()
    .eq('task_id', params.taskId)
    .eq('depends_on', dependsOnId)

  if (error) {
    console.error('[task dependencies DELETE] error:', error)
    return NextResponse.json({ error: 'Error al quitar dependencia' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

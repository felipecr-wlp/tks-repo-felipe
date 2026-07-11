/**
 * GET    /api/tasks/[taskId]/assignees, lista los asignados (multi) de la tarea.
 * POST   /api/tasks/[taskId]/assignees  { profileId }, agrega un asignado.
 * DELETE /api/tasks/[taskId]/assignees?profileId=..., quita un asignado.
 *
 * Reutiliza la tabla nueva `task_assignees` (PK task_id+profile_id). Para
 * compatibilidad con vistas que aun leen `tasks.assignee_id` (tablero, listas,
 * scrum), se mantiene ese campo sincronizado como "asignado principal": al
 * agregar, si estaba vacio se llena; al quitar, si coincide se reasigna a otro
 * asignado restante o a null.
 *
 * Anti-IDOR: el taskId viene de la ruta y se valida por membresia; el profileId
 * a agregar debe pertenecer al proyecto o a su workspace.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { checkTaskAccess } from '@/lib/task-access'
import { autoWatch } from '@/lib/watchers'

interface RouteParams {
  params: { taskId: string }
}

const postSchema = z.object({ profileId: z.string().uuid() })

type Member = { id: string; display_name: string; avatar_url: string | null }

async function listAssignees(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  taskId: string,
): Promise<Member[]> {
  type Row = { profile: Member | null }
  const { data } = await admin
    .from('task_assignees')
    .select('profile:profiles ( id, display_name, avatar_url )')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true }) as { data: Row[] | null }
  return (data ?? []).map(r => r.profile).filter((p): p is Member => p != null)
}

// Verifica que el profile pertenezca al proyecto o a su workspace.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function profileInProject(admin: any, projectId: string, profileId: string): Promise<boolean> {
  const { data: pmem } = await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', projectId)
    .eq('profile_id', profileId)
    .maybeSingle() as { data: { profile_id: string } | null }
  if (pmem) return true

  const { data: project } = await admin
    .from('projects')
    .select('workspace_id')
    .eq('id', projectId)
    .maybeSingle() as { data: { workspace_id: string } | null }
  if (!project) return false

  const { data: wmem } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', project.workspace_id)
    .eq('profile_id', profileId)
    .maybeSingle() as { data: { profile_id: string } | null }
  return !!wmem
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

  return NextResponse.json({ assignees: await listAssignees(admin, params.taskId) })
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
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })
  const { profileId } = parsed.data

  const admin = createAdminClient()
  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 404 ? 'Tarea no encontrada' : 'Sin acceso' },
      { status: access.status },
    )
  }

  const belongs = await profileInProject(admin, access.projectId as string, profileId)
  if (!belongs) return NextResponse.json({ error: 'Ese usuario no pertenece al proyecto' }, { status: 422 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any
  const { error: insErr } = await db
    .from('task_assignees')
    .upsert(
      { task_id: params.taskId, profile_id: profileId },
      { onConflict: 'task_id,profile_id', ignoreDuplicates: true },
    )
  if (insErr) {
    console.error('[task assignees POST] error:', insErr)
    return NextResponse.json({ error: 'Error al agregar asignado' }, { status: 500 })
  }

  // Mantener assignee_id (principal) poblado para compat si estaba vacio.
  const { data: current } = await admin
    .from('tasks')
    .select('assignee_id')
    .eq('id', params.taskId)
    .maybeSingle() as { data: { assignee_id: string | null } | null }
  if (current && !current.assignee_id) {
    await db.from('tasks').update({ assignee_id: profileId }).eq('id', params.taskId)
  }

  // Auto-seguimiento: el asignado pasa a seguir la tarea (best effort).
  autoWatch(admin, params.taskId, access.projectId as string, profileId).catch(console.error)

  return NextResponse.json({ assignees: await listAssignees(admin, params.taskId) }, { status: 201 })
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const profileId = request.nextUrl.searchParams.get('profileId')
  if (!profileId) return NextResponse.json({ error: 'Falta profileId' }, { status: 400 })

  const admin = createAdminClient()
  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.status === 404 ? 'Tarea no encontrada' : 'Sin acceso' },
      { status: access.status },
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any
  const { error } = await db
    .from('task_assignees')
    .delete()
    .eq('task_id', params.taskId)
    .eq('profile_id', profileId)
  if (error) {
    console.error('[task assignees DELETE] error:', error)
    return NextResponse.json({ error: 'Error al quitar asignado' }, { status: 500 })
  }

  // Si el asignado principal era este, reasignar a otro restante o a null.
  const { data: current } = await admin
    .from('tasks')
    .select('assignee_id')
    .eq('id', params.taskId)
    .maybeSingle() as { data: { assignee_id: string | null } | null }
  if (current && current.assignee_id === profileId) {
    const remaining = await listAssignees(admin, params.taskId)
    await db.from('tasks').update({ assignee_id: remaining[0]?.id ?? null }).eq('id', params.taskId)
  }

  return NextResponse.json({ assignees: await listAssignees(admin, params.taskId) })
}

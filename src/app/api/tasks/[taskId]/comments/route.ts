/**
 * GET  /api/tasks/[taskId]/comments, Lista comentarios de una tarea
 * POST /api/tasks/[taskId]/comments, Agrega un comentario
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { autoWatch } from '@/lib/watchers'
import { logActivity, ActivityVerbs, NotificationTypes, notifyTaskWatchers } from '@/lib/activity'
import { canAccessProject, ERROR_ACCESO_INDETERMINADO } from '@/lib/team-access'

export async function GET(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  // Verificar acceso a la tarea
  type TaskCheck = { project_id: string }
  const { data: task } = await admin
    .from('tasks')
    .select('project_id')
    .eq('id', params.taskId)
    .maybeSingle() as { data: TaskCheck | null; error: unknown }
  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

  const { ok: canAccess, failed: accessFailed } = await canAccessProject(admin, task.project_id, user.id)
  // `failed` = la verificacion no se pudo completar (no es una negativa).
  if (accessFailed) return NextResponse.json({ error: ERROR_ACCESO_INDETERMINADO }, { status: 500 })
  if (!canAccess) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  type CommentRow = {
    id: string
    body: string
    created_at: string
    author: { id: string; display_name: string; avatar_url: string | null } | null
  }
  type RawCommentRow = {
    id: string
    content: string
    created_at: string
    author: { id: string; display_name: string; avatar_url: string | null } | null
  }

  // Paginacion por cursor. Antes se cargaban los 100 comentarios mas ANTIGUOS
  // (ASC limit 100), asi que pasando 100 se ocultaban los recientes, que es lo
  // peor para un hilo. Ahora se traen los mas NUEVOS primero y la UI pide los
  // anteriores con el parametro `before` (created_at del comentario mas viejo
  // que ya tiene en pantalla).
  const url = new URL(request.url)
  const before = url.searchParams.get('before')
  const rawLimit = parseInt(url.searchParams.get('limit') ?? '30', 10)
  const pageSize = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 30

  let query = admin
    .from('task_comments')
    .select('id, content, created_at, author:profiles ( id, display_name, avatar_url )')
    .eq('task_id', params.taskId)
    .order('created_at', { ascending: false })
    .limit(pageSize + 1) // +1 para saber si hay mas paginas sin un count aparte

  if (before) query = query.lt('created_at', before)

  const { data: rawComments } = await query as { data: RawCommentRow[] | null; error: unknown }

  const rows = rawComments ?? []
  const hasMore = rows.length > pageSize
  const page = hasMore ? rows.slice(0, pageSize) : rows

  // Mapear `content` -> `body` y devolver en orden ascendente (viejo -> nuevo)
  // para que la UI los pinte de arriba hacia abajo como una conversacion.
  const comments: CommentRow[] = page
    .map(c => ({ id: c.id, body: c.content, created_at: c.created_at, author: c.author }))
    .reverse()

  return NextResponse.json({ comments, has_more: hasMore })
}

export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = z.object({ body: z.string().min(1).max(5000).trim() }).safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()

  type TaskCheck = { project_id: string; workspace_id: string; title: string }
  const { data: task } = await admin
    .from('tasks')
    .select('project_id, workspace_id, title')
    .eq('id', params.taskId)
    .maybeSingle() as { data: TaskCheck | null; error: unknown }
  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

  const { ok: canAccess, failed: accessFailed } = await canAccessProject(admin, task.project_id, user.id)
  // `failed` = la verificacion no se pudo completar (no es una negativa).
  if (accessFailed) return NextResponse.json({ error: ERROR_ACCESO_INDETERMINADO }, { status: 500 })
  if (!canAccess) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  type RawCommentResult = {
    id: string
    content: string
    created_at: string
    author: { id: string; display_name: string; avatar_url: string | null } | null
  }
  const { data: raw, error: insertError } = await admin
    .from('task_comments')
    .insert({
      task_id: params.taskId,
      project_id: task.project_id,
      workspace_id: task.workspace_id,
      author_id: user.id,
      content: parsed.data.body,
    })
    .select('id, content, created_at, author:profiles ( id, display_name, avatar_url )')
    .single() as { data: RawCommentResult | null; error: unknown }

  if (insertError || !raw) {
    console.error('[comments POST] insert error:', insertError)
    return NextResponse.json({
      error: 'Error al crear el comentario',    }, { status: 500 })
  }

  // Auto-seguimiento: quien comenta pasa a seguir la tarea (best effort).
  autoWatch(admin, params.taskId, task.project_id, user.id).catch(console.error)

  // Log de actividad: el comentario aparece en el historial del panel (B12).
  logActivity({
    verb: ActivityVerbs.COMMENT_ADDED,
    subject_id: user.id,
    object_type: 'task',
    object_id: params.taskId,
    object_title: task.title,
    workspace_id: task.workspace_id,
    project_id: task.project_id,
  }).catch(console.error)

  // Notificar a los seguidores (menos al autor) que hay un comentario nuevo.
  notifyTaskWatchers({
    taskId: params.taskId,
    actorId: user.id,
    taskTitle: task.title,
    workspaceId: task.workspace_id,
    notifType: NotificationTypes.TASK_COMMENTED,
  }).catch(console.error)

  return NextResponse.json({
    id: raw.id,
    body: raw.content,
    created_at: raw.created_at,
    author: raw.author,
  }, { status: 201 })
}

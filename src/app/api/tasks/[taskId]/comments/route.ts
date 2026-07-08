/**
 * GET  /api/tasks/[taskId]/comments — Lista comentarios de una tarea
 * POST /api/tasks/[taskId]/comments — Agrega un comentario
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
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

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', task.project_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

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
  const { data: rawComments } = await admin
    .from('task_comments')
    .select('id, content, created_at, author:profiles ( id, display_name, avatar_url )')
    .eq('task_id', params.taskId)
    .order('created_at', { ascending: true })
    .limit(100) as { data: RawCommentRow[] | null; error: unknown }

  // Mapear `content` → `body` para la UI
  const comments: CommentRow[] = (rawComments ?? []).map(c => ({
    id: c.id,
    body: c.content,
    created_at: c.created_at,
    author: c.author,
  }))

  return NextResponse.json(comments)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
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

  type TaskCheck = { project_id: string; workspace_id: string }
  const { data: task } = await admin
    .from('tasks')
    .select('project_id, workspace_id')
    .eq('id', params.taskId)
    .maybeSingle() as { data: TaskCheck | null; error: unknown }
  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', task.project_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  type RawCommentResult = {
    id: string
    content: string
    created_at: string
    author: { id: string; display_name: string; avatar_url: string | null } | null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw, error: insertError } = await (admin as any)
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
      error: 'Error al crear el comentario',
      details: (insertError as { message?: string })?.message,
    }, { status: 500 })
  }

  return NextResponse.json({
    id: raw.id,
    body: raw.content,
    created_at: raw.created_at,
    author: raw.author,
  }, { status: 201 })
}

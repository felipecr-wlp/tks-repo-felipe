/**
 * PATCH  /api/tasks/[taskId]/comments/[commentId], Edita un comentario (solo autor)
 * DELETE /api/tasks/[taskId]/comments/[commentId], Elimina un comentario (solo autor)
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

type CommentOwner = { id: string; author_id: string; task_id: string }

async function loadOwnComment(
  admin: ReturnType<typeof createAdminClient>,
  commentId: string,
  taskId: string,
  userId: string
): Promise<{ ok: true } | { ok: false; res: NextResponse }> {
  const { data: comment } = await admin
    .from('task_comments')
    .select('id, author_id, task_id')
    .eq('id', commentId)
    .maybeSingle() as { data: CommentOwner | null; error: unknown }

  if (!comment || comment.task_id !== taskId) {
    return { ok: false, res: NextResponse.json({ error: 'Comentario no encontrado' }, { status: 404 }) }
  }
  if (comment.author_id !== userId) {
    return { ok: false, res: NextResponse.json({ error: 'Solo el autor puede modificarlo' }, { status: 403 }) }
  }
  return { ok: true }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { taskId: string; commentId: string } }
) {
  if (!isUuid(params.taskId) || !isUuid(params.commentId)) {
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
  const check = await loadOwnComment(admin, params.commentId, params.taskId, user.id)
  if (!check.ok) return check.res

  type RawResult = {
    id: string
    content: string
    created_at: string
    author: { id: string; display_name: string; avatar_url: string | null } | null
  }
  const { data: raw, error } = await admin
    .from('task_comments')
    .update({ content: parsed.data.body, updated_at: new Date().toISOString() })
    .eq('id', params.commentId)
    .select('id, content, created_at, author:profiles ( id, display_name, avatar_url )')
    .single() as { data: RawResult | null; error: unknown }

  if (error || !raw) {
    return NextResponse.json({ error: 'Error al editar el comentario' }, { status: 500 })
  }

  return NextResponse.json({
    id: raw.id,
    body: raw.content,
    created_at: raw.created_at,
    author: raw.author,
  })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { taskId: string; commentId: string } }
) {
  if (!isUuid(params.taskId) || !isUuid(params.commentId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const check = await loadOwnComment(admin, params.commentId, params.taskId, user.id)
  if (!check.ok) return check.res

  const { error } = await admin
    .from('task_comments')
    .delete()
    .eq('id', params.commentId)

  if (error) {
    return NextResponse.json({ error: 'Error al eliminar el comentario' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

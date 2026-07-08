/**
 * GET    /api/whiteboards/[id] — detalle (incluye content JSON)
 * PATCH  /api/whiteboards/[id] — actualiza title/content/visibility
 * DELETE /api/whiteboards/[id] — elimina
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'

interface RouteParams {
  params: { whiteboardId: string }
}

const patchSchema = z.object({
  title:      z.string().max(200).trim().optional(),
  content:    z.string().nullable().optional(),
  visibility: z.enum(['private', 'project', 'team', 'workspace']).optional(),
}).strict()

interface WhiteboardFull {
  id: string
  workspace_id: string
  project_id: string | null
  title: string
  content: string | null
  visibility: string
  created_by: string | null
  created_at: string
  updated_at: string
  author: { display_name: string; avatar_url: string | null } | null
}

async function loadWithAccess(
  admin: ReturnType<typeof createAdminClient>,
  id: string,
  userId: string,
): Promise<{ board: WhiteboardFull | null; status: number }> {
  const { data: board } = await admin
    .from('whiteboards')
    .select(`
      id, workspace_id, project_id, title, content, visibility,
      created_by, created_at, updated_at,
      author:profiles ( display_name, avatar_url )
    `)
    .eq('id', id)
    .maybeSingle() as { data: WhiteboardFull | null; error: unknown }

  if (!board) return { board: null, status: 404 }

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', board.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return { board: null, status: 403 }
  if (board.visibility === 'private' && board.created_by !== userId) {
    return { board: null, status: 403 }
  }
  return { board, status: 200 }
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { board, status } = await loadWithAccess(admin, params.whiteboardId, user.id)
  if (!board) return NextResponse.json({ error: 'No encontrada' }, { status })
  return NextResponse.json(board)
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()
  const { board, status } = await loadWithAccess(admin, params.whiteboardId, user.id)
  if (!board) return NextResponse.json({ error: 'No encontrada' }, { status })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = await (admin as any)
    .from('whiteboards')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.whiteboardId)
    .select(`
      id, workspace_id, project_id, title, content, visibility,
      created_by, created_at, updated_at,
      author:profiles ( display_name, avatar_url )
    `)
    .single() as { data: WhiteboardFull | null; error: unknown }

  if (error || !updated) {
    return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })
  }

  logActivity({
    verb: ActivityVerbs.WHITEBOARD_UPDATED,
    subject_id: user.id,
    object_type: 'whiteboard',
    object_id: updated.id,
    object_title: updated.title,
    workspace_id: updated.workspace_id,
  }).catch(console.error)

  return NextResponse.json(updated)
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { board, status } = await loadWithAccess(admin, params.whiteboardId, user.id)
  if (!board) return NextResponse.json({ error: 'No encontrada' }, { status })

  // Permitir creador OR workspace admin OR org owner/admin
  let canDelete = board.created_by === user.id
  if (!canDelete) {
    const { data: profile } = await admin
      .from('profiles')
      .select('org_role')
      .eq('id', user.id)
      .maybeSingle() as { data: { org_role: string | null } | null; error: unknown }
    if (profile?.org_role === 'owner' || profile?.org_role === 'admin') canDelete = true
  }
  if (!canDelete) {
    const { data: wsMember } = await admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', board.workspace_id)
      .eq('profile_id', user.id)
      .maybeSingle() as { data: { role: string } | null; error: unknown }
    if (wsMember?.role === 'admin') canDelete = true
  }
  if (!canDelete) {
    return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('whiteboards').delete().eq('id', params.whiteboardId)
  if (error) return NextResponse.json({ error: 'Error al eliminar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

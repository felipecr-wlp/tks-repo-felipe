import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'

interface RouteParams {
  params: { flowId: string }
}

const patchSchema = z.object({
  title:      z.string().max(200).trim().optional(),
  description: z.string().max(2000).nullable().optional(),
  nodes:      z.array(z.unknown()).optional(),
  edges:      z.array(z.unknown()).optional(),
  visibility: z.enum(['private', 'project', 'team', 'workspace']).optional(),
}).strict()

interface FlowFull {
  id: string
  workspace_id: string
  project_id: string | null
  title: string
  description: string | null
  nodes: unknown
  edges: unknown
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
): Promise<{ flow: FlowFull | null; status: number }> {
  const { data: flow } = await admin
    .from('flows')
    .select(`
      id, workspace_id, project_id, title, description, nodes, edges, visibility,
      created_by, created_at, updated_at,
      author:profiles ( display_name, avatar_url )
    `)
    .eq('id', id)
    .maybeSingle() as { data: FlowFull | null; error: unknown }

  if (!flow) return { flow: null, status: 404 }

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', flow.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return { flow: null, status: 403 }
  if (flow.visibility === 'private' && flow.created_by !== userId) {
    return { flow: null, status: 403 }
  }
  return { flow, status: 200 }
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.flowId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { flow, status } = await loadWithAccess(admin, params.flowId, user.id)
  if (!flow) return NextResponse.json({ error: 'No encontrado' }, { status })

  const { data: shares } = await admin
    .from('flow_shares')
    .select('id, permission, profile:profiles(id, email, display_name, avatar_url)')
    .eq('flow_id', params.flowId) as { data: any[] | null; error: unknown }

  return NextResponse.json({ ...flow, shares: shares ?? [] })
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.flowId)) {
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
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()
  const { flow, status } = await loadWithAccess(admin, params.flowId, user.id)
  if (!flow) return NextResponse.json({ error: 'No encontrado' }, { status })

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description
  if (parsed.data.visibility !== undefined) updateData.visibility = parsed.data.visibility
  if (parsed.data.nodes !== undefined) updateData.nodes = parsed.data.nodes
  if (parsed.data.edges !== undefined) updateData.edges = parsed.data.edges

  const { data: updated, error } = await admin
    .from('flows')
    .update(updateData)
    .eq('id', params.flowId)
    .select(`
      id, workspace_id, project_id, title, description, nodes, edges, visibility,
      created_by, created_at, updated_at,
      author:profiles ( display_name, avatar_url )
    `)
    .single() as { data: FlowFull | null; error: unknown }

  if (error || !updated) {
    return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })
  }

  logActivity({
    verb: ActivityVerbs.FLOW_UPDATED,
    subject_id: user.id,
    object_type: 'flow',
    object_id: updated.id,
    object_title: updated.title,
    workspace_id: updated.workspace_id,
  }).catch(console.error)

  return NextResponse.json(updated)
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.flowId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { flow, status } = await loadWithAccess(admin, params.flowId, user.id)
  if (!flow) return NextResponse.json({ error: 'No encontrado' }, { status })

  let canDelete = flow.created_by === user.id
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
      .eq('workspace_id', flow.workspace_id)
      .eq('profile_id', user.id)
      .maybeSingle() as { data: { role: string } | null; error: unknown }
    if (wsMember?.role === 'admin') canDelete = true
  }
  if (!canDelete) {
    return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
  }

  const { error } = await admin.from('flows').delete().eq('id', params.flowId)
  if (error) return NextResponse.json({ error: 'Error al eliminar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

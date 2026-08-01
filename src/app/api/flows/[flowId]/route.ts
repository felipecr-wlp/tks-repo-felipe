import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'
import { resolveFlowAccess, type FlowAccess } from '@/lib/flows/access'

interface RouteParams {
  params: { flowId: string }
}

const patchSchema = z.object({
  title:      z.string().max(200).trim().optional(),
  description: z.string().max(2000).nullable().optional(),
  // Techos generosos, no restrictivos: un diagrama humano no pasa de unas decenas
  // de nodos. Sin `.max`, el body de un Route Handler del App Router no tiene
  // limite y un arreglo arbitrario se bufferiza entero antes de validarse, se
  // guarda en la columna jsonb y se relee en cada apertura del flujo.
  nodes:      z.array(z.unknown()).max(2000).optional(),
  edges:      z.array(z.unknown()).max(4000).optional(),
  visibility: z.enum(['private', 'project', 'team', 'workspace']).optional(),
  // Version del flujo sobre la que se hicieron los cambios. Si en la base ya hay
  // otra mas nueva, alguien mas guardo primero y se responde 409 en vez de
  // pisarlo. El editor decide entonces si recarga o si insiste sin este campo.
  // Es un instante ISO: 40 caracteres sobran y cualquier cosa mas larga no es
  // una fecha, es un intento de gastar memoria.
  expected_updated_at: z.string().max(40).optional(),
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
): Promise<{ flow: FlowFull | null; status: number; access: FlowAccess }> {
  const { data: flow } = await admin
    .from('flows')
    .select(`
      id, workspace_id, project_id, title, description, nodes, edges, visibility,
      created_by, created_at, updated_at,
      author:profiles ( display_name, avatar_url )
    `)
    .eq('id', id)
    .maybeSingle() as { data: FlowFull | null; error: unknown }

  if (!flow) return { flow: null, status: 404, access: 'none' }

  const access = await resolveFlowAccess(admin, {
    flowId: flow.id,
    workspaceId: flow.workspace_id,
    createdBy: flow.created_by,
    visibility: flow.visibility,
    userId,
  })

  if (access === 'none') return { flow: null, status: 403, access }
  return { flow, status: 200, access }
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.flowId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { flow, status, access } = await loadWithAccess(admin, params.flowId, user.id)
  if (!flow) return NextResponse.json({ error: 'No encontrado' }, { status })

  // La lista de con quien esta compartido es informacion del duenno. Quien solo
  // tiene acceso de lectura no necesita saber a quien mas se lo compartieron.
  const puedeVerShares = flow.created_by === user.id || access === 'edit'
  const { data: shares } = puedeVerShares
    ? ((await admin
        .from('flow_shares')
        .select('id, permission, profile:profiles(id, email, display_name, avatar_url)')
        .eq('flow_id', params.flowId)) as { data: unknown[] | null; error: unknown })
    : { data: [] }

  return NextResponse.json({ ...flow, shares: shares ?? [], access })
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
  const { flow, status, access } = await loadWithAccess(admin, params.flowId, user.id)
  if (!flow) return NextResponse.json({ error: 'No encontrado' }, { status })

  // Leer no es editar: un share de solo lectura llega hasta aqui y se detiene.
  if (access !== 'edit') {
    return NextResponse.json({ error: 'Solo tienes acceso de lectura' }, { status: 403 })
  }

  // Cambiar la visibilidad es del duenno, no de cualquiera que pueda editar.
  if (parsed.data.visibility !== undefined && flow.created_by !== user.id) {
    return NextResponse.json(
      { error: 'Solo quien creó el flujo puede cambiar su visibilidad' },
      { status: 403 },
    )
  }

  // Control de concurrencia. Sin esto, dos personas editando el mismo flujo se
  // pisan en silencio: gana quien guarde de ultimo y el otro pierde su trabajo
  // sin enterarse. Se comparan instantes, no cadenas, porque el formato del
  // timestamp que devuelve Postgres no siempre es identico al que se guardo.
  if (parsed.data.expected_updated_at) {
    const esperado = new Date(parsed.data.expected_updated_at).getTime()
    const actual = new Date(flow.updated_at).getTime()
    if (Number.isFinite(esperado) && Number.isFinite(actual) && esperado !== actual) {
      return NextResponse.json(
        { error: 'El flujo cambió desde que lo abriste', current_updated_at: flow.updated_at },
        { status: 409 },
      )
    }
  }

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (parsed.data.title !== undefined) updateData.title = parsed.data.title
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description
  if (parsed.data.visibility !== undefined) updateData.visibility = parsed.data.visibility
  if (parsed.data.nodes !== undefined) updateData.nodes = parsed.data.nodes
  if (parsed.data.edges !== undefined) updateData.edges = parsed.data.edges

  const { data: updated, error } = await admin
    .from('flows')
    .update(updateData as never)
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

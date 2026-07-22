/**
 * POST /api/projects/[projectId]/messages, Publica un mensaje en el chat del proyecto.
 * GET  /api/projects/[projectId]/messages, Historial (ultimos 100).
 * Body POST: { body }
 *
 * Authz: miembros del proyecto o de su workspace (consistente con la politica de
 * lectura de project_messages). La escritura la hace el server con admin client;
 * el realtime sobre project_messages entrega el mensaje a los demas en vivo.
 * Anti-IDOR: el projectId viene de la ruta, se valida contra la membresia real;
 * el workspace_id se resuelve del proyecto, nunca del body.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const schema = z.object({
  body: z.string().min(1).max(4000).trim(),
}).strict()

// Verifica que el user pertenezca al proyecto o a su workspace.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function canAccessProject(admin: any, projectId: string, userId: string): Promise<{ ok: boolean; workspaceId: string | null }> {
  const { data: project } = await admin
    .from('projects')
    .select('id, workspace_id')
    .eq('id', projectId)
    .maybeSingle() as { data: { id: string; workspace_id: string } | null }
  if (!project) return { ok: false, workspaceId: null }

  const { data: pmem } = await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', projectId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { profile_id: string } | null }
  if (pmem) return { ok: true, workspaceId: project.workspace_id }

  const { data: wmem } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', project.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { profile_id: string } | null }
  return { ok: !!wmem, workspaceId: project.workspace_id }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const access = await canAccessProject(admin, params.projectId, user.id)
  if (!access.ok) return NextResponse.json({ error: 'Sin acceso al proyecto' }, { status: 403 })

  const { data: rows, error: rowsError } = await admin
    .from('project_messages')
    .select('id, project_id, author_id, body, created_at')
    .eq('project_id', params.projectId)
    .order('created_at', { ascending: false })
    .limit(100) as { data: { id: string; project_id: string; author_id: string; body: string; created_at: string }[] | null; error: unknown }

  if (rowsError) {
    console.error('[project messages GET] read error:', rowsError)
    return NextResponse.json({ error: 'Error al cargar mensajes' }, { status: 500 })
  }

  return NextResponse.json((rows ?? []).reverse())
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()
  const access = await canAccessProject(admin, params.projectId, user.id)
  if (!access.ok || !access.workspaceId) {
    return NextResponse.json({ error: 'Sin acceso al proyecto' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: message, error } = await (admin as any)
    .from('project_messages')
    .insert({
      project_id:   params.projectId,
      workspace_id: access.workspaceId,
      author_id:    user.id,
      body:         parsed.data.body,
    })
    .select('id, project_id, author_id, body, created_at')
    .single()

  if (error || !message) {
    console.error('[project messages POST] insert error:', error)
    return NextResponse.json({ error: 'Error al enviar el mensaje' }, { status: 500 })
  }

  return NextResponse.json(message, { status: 201 })
}

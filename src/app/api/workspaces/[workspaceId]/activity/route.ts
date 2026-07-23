/**
 * GET /api/workspaces/[workspaceId]/activity?limit=&offset=&project_id=
 *
 * Bitacora (audit log) del workspace: lee activity_events del workspace, mas
 * recientes primero, con el actor (subject) y el proyecto resueltos. Alimenta la
 * pagina /w/[slug]/activity (feed de "quien hizo que y cuando" a nivel de todo el
 * workspace, no solo de una tarea como /api/tasks/[taskId]/activity).
 *
 * Seguridad (mismo patron que las rutas hermanas):
 *   - Auth obligatorio (401), rate limit.
 *   - Anti-IDOR: se re-verifica que el usuario sea MIEMBRO del workspace via
 *     workspace_members antes de devolver nada (admin client bypassa RLS, por eso
 *     el check explicito). El workspaceId viene de la ruta, nunca del cuerpo.
 *   - Paginacion por limit/offset validada con zod .strict().
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { workspaceId: string }
}

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  project_id: z.string().uuid().optional(),
}).strict()

const DEFAULT_LIMIT = 40

export type WorkspaceActivityEvent = {
  id: string
  verb: string
  object_type: string
  object_id: string | null
  object_title: string | null
  created_at: string
  subject: { id: string; display_name: string | null; avatar_url: string | null } | null
  project: { name: string; slug: string } | null
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.workspaceId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const parsed = querySchema.safeParse({
    limit: searchParams.get('limit') ?? undefined,
    offset: searchParams.get('offset') ?? undefined,
    project_id: searchParams.get('project_id') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Parámetros inválidos', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  const admin = createAdminClient()

  // Anti-IDOR: el usuario debe ser miembro del workspace.
  const { data: membership, error: memberErr } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', params.workspaceId)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { profile_id: string } | null; error: unknown }
  if (memberErr) {
    console.error('[workspace activity GET] membership read error:', memberErr)
    return NextResponse.json({ error: 'Error al cargar actividad' }, { status: 500 })
  }
  if (!membership) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const limit = Math.min(parsed.data.limit ?? DEFAULT_LIMIT, 100)
  const offset = parsed.data.offset ?? 0

  // Se pide una fila extra (limit + 1) para saber si hay mas paginas sin un
  // COUNT aparte.
  let query = admin
    .from('activity_events')
    .select(`
      id,
      verb,
      object_type,
      object_id,
      object_title,
      created_at,
      subject:profiles ( id, display_name, avatar_url ),
      project:projects ( name, slug )
    `)
    .eq('workspace_id', params.workspaceId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit) // inclusivo: trae limit + 1

  if (parsed.data.project_id) {
    query = query.eq('project_id', parsed.data.project_id)
  }

  const { data, error } = await query as {
    data: WorkspaceActivityEvent[] | null
    error: unknown
  }
  if (error) {
    console.error('[workspace activity GET] read error:', error)
    return NextResponse.json({ error: 'Error al cargar actividad' }, { status: 500 })
  }

  const rows = data ?? []
  const hasMore = rows.length > limit
  const events = hasMore ? rows.slice(0, limit) : rows

  return NextResponse.json({
    events,
    nextOffset: hasMore ? offset + limit : null,
  })
}

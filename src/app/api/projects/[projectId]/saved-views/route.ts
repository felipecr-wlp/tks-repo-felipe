/**
 * GET  /api/projects/[projectId]/saved-views, lista las vistas guardadas propias
 * POST /api/projects/[projectId]/saved-views, crea una vista guardada
 *
 * Una vista guardada es una combinacion de filtros (estado, prioridad, asignado,
 * tipo de vista) que el usuario nombra para reusar. Son PRIVADAS por usuario:
 * cada quien ve solo las suyas en el proyecto.
 *
 * Anti-IDOR: el projectId viene de la ruta y se valida por membresia del proyecto
 * antes de leer o escribir (el admin client ignora RLS).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { projectId: string }
}

type SavedViewRow = {
  id: string
  name: string
  filters: Record<string, unknown>
  created_at: string
}

async function assertMember(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  return !!data
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await assertMember(admin, params.projectId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const { data } = await admin
    .from('task_saved_views')
    .select('id, name, filters, created_at')
    .eq('project_id', params.projectId)
    .eq('profile_id', user.id)
    .order('created_at', { ascending: true }) as { data: SavedViewRow[] | null }

  return NextResponse.json({ views: data ?? [] })
}

const filterSchema = z.object({
  view: z.string().max(20).optional(),
  status: z.string().uuid().optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional(),
  assignee: z.string().uuid().optional(),
}).strict()

const postSchema = z.object({
  name: z.string().min(1).max(60).trim(),
  filters: filterSchema,
}).strict()

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }

  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()
  if (!(await assertMember(admin, params.projectId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('task_saved_views')
    .insert({
      project_id: params.projectId,
      profile_id: user.id,
      name: parsed.data.name,
      filters: parsed.data.filters,
    })
    .select('id, name, filters, created_at')
    .single() as { data: SavedViewRow | null; error: unknown }

  if (error || !data) {
    console.error('[saved-views POST] insert error:', error)
    return NextResponse.json({ error: 'Error al guardar la vista' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

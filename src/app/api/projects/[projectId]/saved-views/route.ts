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
  sort: Record<string, unknown> | null
  is_shared: boolean
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

  // Vistas propias del usuario mas las compartidas del proyecto (or) para que
  // el equipo reutilice configuraciones publicadas sin dejar de ver las privadas.
  const { data } = await admin
    .from('task_saved_views')
    .select('id, name, filters, sort, is_shared, created_at')
    .eq('project_id', params.projectId)
    .or(`profile_id.eq.${user.id},is_shared.eq.true`)
    .order('created_at', { ascending: true }) as { data: SavedViewRow[] | null }

  return NextResponse.json({ views: data ?? [] })
}

const PRIORITY_VALUES = ['urgent', 'high', 'medium', 'low', 'none'] as const

// Acepta la forma corta que ya usa el tablero (view/status/priority/assignee)
// y, aditivamente, la forma en arreglos (statuses/priorities/labels/assignees +
// search) para filtros avanzados. Ambas conviven sin romper vistas existentes.
const filterSchema = z.object({
  view: z.string().max(20).optional(),
  status: z.string().uuid().optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  assignee: z.string().uuid().optional(),
  statuses: z.array(z.string().uuid()).max(50).optional(),
  priorities: z.array(z.enum(PRIORITY_VALUES)).max(5).optional(),
  labels: z.array(z.string().uuid()).max(50).optional(),
  assignees: z.array(z.string().uuid()).max(50).optional(),
  search: z.string().max(200).optional(),
}).strict()

const sortSchema = z.object({
  field: z.string().max(40),
  dir: z.enum(['asc', 'desc']),
}).strict()

const postSchema = z.object({
  name: z.string().min(1).max(60).trim(),
  filters: filterSchema,
  sort: sortSchema.nullish(),
  isShared: z.boolean().optional(),
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

  const { data, error } = await admin
    .from('task_saved_views')
    .insert({
      project_id: params.projectId,
      profile_id: user.id,
      created_by: user.id,
      name: parsed.data.name,
      filters: parsed.data.filters,
      sort: parsed.data.sort ?? null,
      is_shared: parsed.data.isShared ?? false,
    })
    .select('id, name, filters, sort, is_shared, created_at')
    .single() as { data: SavedViewRow | null; error: unknown }

  if (error || !data) {
    console.error('[saved-views POST] insert error:', error)
    return NextResponse.json({ error: 'Error al guardar la vista' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

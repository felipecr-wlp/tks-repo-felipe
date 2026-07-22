/**
 * PATCH  /api/projects/[projectId]/saved-views/[viewId], actualiza una vista propia.
 * DELETE /api/projects/[projectId]/saved-views/[viewId], borra una vista guardada propia.
 *
 * Anti-IDOR: valida membresia del proyecto y ademas que la vista pertenezca al
 * usuario (profile_id), para que nadie edite o borre las vistas privadas de otro.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { projectId: string; viewId: string }
}

const PRIORITY_VALUES = ['urgent', 'high', 'medium', 'low', 'none'] as const

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

// Al menos un campo; todos opcionales para permitir renombrar, cambiar filtros,
// reordenar o alternar compartida sin reenviar el resto.
const patchSchema = z.object({
  name: z.string().min(1).max(60).trim().optional(),
  filters: filterSchema.optional(),
  sort: sortSchema.nullish(),
  isShared: z.boolean().optional(),
}).strict().refine(
  v => v.name !== undefined || v.filters !== undefined || v.sort !== undefined || v.isShared !== undefined,
  { message: 'Nada que actualizar' },
)

type SavedViewRow = {
  id: string
  name: string
  filters: Record<string, unknown>
  sort: Record<string, unknown> | null
  is_shared: boolean
  created_at: string
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.projectId) || !isUuid(params.viewId)) {
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

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', params.projectId)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Solo el dueño (profile_id) puede modificar su vista.
  const patch: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) patch.name = parsed.data.name
  if (parsed.data.filters !== undefined) patch.filters = parsed.data.filters
  if (parsed.data.sort !== undefined) patch.sort = parsed.data.sort
  if (parsed.data.isShared !== undefined) patch.is_shared = parsed.data.isShared

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('task_saved_views')
    .update(patch)
    .eq('id', params.viewId)
    .eq('project_id', params.projectId)
    .eq('profile_id', user.id)
    .select('id, name, filters, sort, is_shared, created_at')
    .maybeSingle() as { data: SavedViewRow | null; error: unknown }

  if (error) {
    console.error('[saved-views PATCH] error:', error)
    return NextResponse.json({ error: 'Error al actualizar la vista' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Vista no encontrada' }, { status: 404 })
  }

  return NextResponse.json(data)
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.projectId) || !isUuid(params.viewId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', params.projectId)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('task_saved_views')
    .delete()
    .eq('id', params.viewId)
    .eq('project_id', params.projectId)
    .eq('profile_id', user.id)

  if (error) {
    console.error('[saved-views DELETE] error:', error)
    return NextResponse.json({ error: 'Error al borrar la vista' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

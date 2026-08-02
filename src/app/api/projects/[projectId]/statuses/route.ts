/**
 * GET   /api/projects/[projectId]/statuses, Lista los estados del proyecto.
 * POST  /api/projects/[projectId]/statuses, Crea un estado nuevo.
 * PATCH /api/projects/[projectId]/statuses, Reordena (batch de posiciones).
 *
 * Personalizacion de estados estilo Jira/ClickUp: nombre, color (hex), categoria
 * y orden. LECTURA amplia (cualquiera con acceso al proyecto, para pintar el
 * tablero); ESCRITURA solo administradores del proyecto/workspace/org.
 * Anti-IDOR: project_id viene de la ruta.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canManageProject, canAccessProject, ERROR_ACCESO_INDETERMINADO } from '@/lib/team-access'

const HEX = /^#[0-9a-fA-F]{6}$/
const CATEGORIES = ['todo', 'in_progress', 'done', 'cancelled'] as const

const createSchema = z.object({
  name:     z.string().min(1).max(40).trim(),
  color:    z.string().regex(HEX, 'Color hex invalido').default('#6b7280'),
  category: z.enum(CATEGORIES).default('todo'),
}).strict()

const reorderSchema = z.object({
  order: z.array(z.string().uuid()).min(1).max(30),
}).strict()

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
  const { ok, failed } = await canAccessProject(admin, params.projectId, user.id)
  // `failed` = la verificacion no se pudo completar (no es una negativa).
  if (failed) return NextResponse.json({ error: ERROR_ACCESO_INDETERMINADO }, { status: 500 })
  if (!ok) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const { data: statuses, error } = await admin
    .from('task_statuses')
    .select('id, name, color, category, position')
    .eq('project_id', params.projectId)
    .order('position', { ascending: true })

  if (error) {
    console.error('[statuses GET] read error:', error)
    return NextResponse.json({ error: 'Error al cargar estados' }, { status: 500 })
  }

  return NextResponse.json(statuses ?? [])
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

  const parsed = createSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()
  const { ok } = await canManageProject(admin, params.projectId, user.id)
  if (!ok) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Tope de estados por proyecto (evita listas absurdas y protege el tablero).
  const { count } = await admin
    .from('task_statuses')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', params.projectId)
  if ((count ?? 0) >= 30) {
    return NextResponse.json({ error: 'Máximo de 30 estados por proyecto' }, { status: 409 })
  }

  // Nueva columna al final del tablero.
  const { data: last } = await admin
    .from('task_statuses')
    .select('position')
    .eq('project_id', params.projectId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: { position: number } | null }
  const nextPos = (last?.position ?? -1) + 1

  const { data: status, error } = await admin
    .from('task_statuses')
    .insert({
      project_id: params.projectId,
      name:       parsed.data.name,
      color:      parsed.data.color,
      category:   parsed.data.category,
      position:   nextPos,
    })
    .select('id, name, color, category, position')
    .single()

  if (error || !status) {
    console.error('[statuses POST] insert error:', error)
    return NextResponse.json({ error: 'Error al crear el estado' }, { status: 500 })
  }

  return NextResponse.json(status, { status: 201 })
}

export async function PATCH(
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

  const parsed = reorderSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()
  const { ok } = await canManageProject(admin, params.projectId, user.id)
  if (!ok) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Solo reordenamos estados que de verdad pertenecen al proyecto (anti-IDOR).
  const { data: owned } = await admin
    .from('task_statuses')
    .select('id')
    .eq('project_id', params.projectId) as { data: { id: string }[] | null }
  const ownedIds = new Set((owned ?? []).map(s => s.id))

  const updates = parsed.data.order
    .filter(id => ownedIds.has(id))
    .map((id, index) =>
      admin.from('task_statuses').update({ position: index }).eq('id', id).eq('project_id', params.projectId)
    )
  await Promise.all(updates)

  const { data: statuses } = await admin
    .from('task_statuses')
    .select('id, name, color, category, position')
    .eq('project_id', params.projectId)
    .order('position', { ascending: true })

  return NextResponse.json(statuses ?? [])
}

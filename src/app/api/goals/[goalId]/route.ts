/**
 * PATCH  /api/goals/[goalId]   actualiza campos de una meta
 * DELETE /api/goals/[goalId]   borra una meta (CASCADE limpia goal_tasks)
 *
 * Seguridad: la meta debe pertenecer a un workspace donde el usuario es miembro
 * (o admin/owner de la org). El admin client ignora RLS, se valida en handler.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { goalId: string }
}

const patchSchema = z.object({
  title:         z.string().min(1).max(200).optional(),
  description:   z.string().max(2000).optional().nullable(),
  unit:          z.enum(['percent', 'number', 'currency', 'tasks']).optional(),
  progress_mode: z.enum(['manual', 'tasks']).optional(),
  target_value:  z.number().finite().optional(),
  current_value: z.number().finite().optional(),
  status:        z.enum(['on_track', 'at_risk', 'off_track', 'done']).optional(),
  due_date:      z.string().optional().nullable(),
  owner_id:      z.string().uuid().optional().nullable(),
})

// ── Helper: la meta existe y el usuario puede tocarla ────────────────────────
async function goalAccess(
  admin: ReturnType<typeof createAdminClient>,
  goalId: string,
  userId: string,
): Promise<{ ok: boolean; status: number }> {
  const { data: goal } = await admin
    .from('goals')
    .select('workspace_id')
    .eq('id', goalId)
    .maybeSingle() as { data: { workspace_id: string } | null }
  if (!goal) return { ok: false, status: 404 }

  const { data: member } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', goal.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle()
  if (member) return { ok: true, status: 200 }

  const { data: profile } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle() as { data: { org_role: string | null } | null }
  if (profile?.org_role === 'owner' || profile?.org_role === 'admin') return { ok: true, status: 200 }
  return { ok: false, status: 403 }
}

// ── PATCH ─────────────────────────────────────────────────────────────────────
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.goalId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos invalidos' }, { status: 422 })

  const admin = createAdminClient()
  const access = await goalAccess(admin, params.goalId, user.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 404 ? 'Meta no encontrada' : 'Sin acceso' }, { status: access.status })
  }

  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() }
  if ('due_date' in patch && !patch.due_date) patch.due_date = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('goals')
    .update(patch)
    .eq('id', params.goalId)
    .select('id, title, description, unit, progress_mode, target_value, current_value, status, due_date, owner_id, owner:profiles!goals_owner_id_fkey ( id, display_name, avatar_url ), created_at')
    .single()

  if (error) {
    console.error('[goals PATCH] error:', error)
    return NextResponse.json({ error: 'Error al actualizar la meta' }, { status: 500 })
  }

  return NextResponse.json({ goal: { ...data, task_count: 0, task_done: 0 } })
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.goalId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const access = await goalAccess(admin, params.goalId, user.id)
  if (!access.ok) {
    return NextResponse.json({ error: access.status === 404 ? 'Meta no encontrada' : 'Sin acceso' }, { status: access.status })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any).from('goals').delete().eq('id', params.goalId)
  if (error) {
    console.error('[goals DELETE] error:', error)
    return NextResponse.json({ error: 'Error al borrar la meta' }, { status: 500 })
  }
  return NextResponse.json({ success: true })
}

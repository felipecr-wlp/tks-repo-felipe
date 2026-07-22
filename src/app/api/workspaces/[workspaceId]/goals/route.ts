/**
 * GET  /api/workspaces/[workspaceId]/goals
 *   Devuelve { goals: [...] } de un workspace. Para metas en modo 'tasks' agrega
 *   el conteo de tareas enlazadas (done / total) y deriva current/target.
 * POST /api/workspaces/[workspaceId]/goals  { title, description?, unit?, ... }
 *   Crea una meta. progress_mode 'manual' | 'tasks'.
 *
 * Seguridad anclada en el workspace: miembro del workspace o admin/owner de la
 * org. El admin client ignora RLS, por eso la membresia se valida en el handler.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { workspaceId: string }
}

const createSchema = z.object({
  title:         z.string().min(1).max(200),
  description:   z.string().max(2000).optional().nullable(),
  unit:          z.enum(['percent', 'number', 'currency', 'tasks']).default('percent'),
  progress_mode: z.enum(['manual', 'tasks']).default('manual'),
  target_value:  z.number().finite().optional(),
  current_value: z.number().finite().optional(),
  status:        z.enum(['on_track', 'at_risk', 'off_track', 'done']).default('on_track'),
  due_date:      z.string().optional().nullable(),
  owner_id:      z.string().uuid().optional().nullable(),
})

type GoalRow = {
  id: string
  title: string
  description: string | null
  unit: string
  progress_mode: string
  target_value: number
  current_value: number
  status: string
  due_date: string | null
  owner_id: string | null
  owner: { id: string; display_name: string | null; avatar_url: string | null } | null
  created_at: string
}

// ── Helper: membresia al workspace o admin de la org ─────────────────────────
async function hasWorkspaceAccess(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const { data: member } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', userId)
    .maybeSingle()
  if (member) return true
  const { data: profile } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle() as { data: { org_role: string | null } | null }
  return profile?.org_role === 'owner' || profile?.org_role === 'admin'
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.workspaceId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await hasWorkspaceAccess(admin, params.workspaceId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const { data: goals } = await admin
    .from('goals')
    .select('id, title, description, unit, progress_mode, target_value, current_value, status, due_date, owner_id, owner:profiles!goals_owner_id_fkey ( id, display_name, avatar_url ), created_at')
    .eq('workspace_id', params.workspaceId)
    .order('created_at', { ascending: false }) as { data: GoalRow[] | null }

  const list = goals ?? []

  // Para metas en modo 'tasks', agregar conteo de tareas enlazadas (done/total).
  const taskGoalIds = list.filter(g => g.progress_mode === 'tasks').map(g => g.id)
  const counts: Record<string, { done: number; total: number }> = {}
  if (taskGoalIds.length) {
    type LinkRow = { goal_id: string; task: { status: { category: string } | null } | null }
    const { data: links } = await admin
      .from('goal_tasks')
      .select('goal_id, task:tasks ( status:task_statuses ( category ) )')
      .in('goal_id', taskGoalIds) as { data: LinkRow[] | null }
    for (const l of links ?? []) {
      const c = (counts[l.goal_id] ??= { done: 0, total: 0 })
      c.total += 1
      if (l.task?.status?.category === 'done') c.done += 1
    }
  }

  const result = list.map(g => {
    const base = {
      id: g.id,
      title: g.title,
      description: g.description,
      unit: g.unit,
      progress_mode: g.progress_mode,
      target_value: g.target_value,
      current_value: g.current_value,
      status: g.status,
      due_date: g.due_date,
      owner: g.owner,
      created_at: g.created_at,
      task_count: 0,
      task_done: 0,
    }
    if (g.progress_mode === 'tasks') {
      const c = counts[g.id] ?? { done: 0, total: 0 }
      return { ...base, task_count: c.total, task_done: c.done, current_value: c.done, target_value: c.total }
    }
    return base
  })

  return NextResponse.json({ goals: result })
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.workspaceId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos invalidos' }, { status: 422 })

  const admin = createAdminClient()
  if (!(await hasWorkspaceAccess(admin, params.workspaceId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const d = parsed.data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('goals')
    .insert({
      workspace_id:  params.workspaceId,
      title:         d.title,
      description:   d.description ?? null,
      unit:          d.unit,
      progress_mode: d.progress_mode,
      target_value:  d.target_value ?? 100,
      current_value: d.current_value ?? 0,
      status:        d.status,
      due_date:      d.due_date || null,
      owner_id:      d.owner_id ?? null,
      created_by:    user.id,
    })
    .select('id, title, description, unit, progress_mode, target_value, current_value, status, due_date, owner_id, owner:profiles!goals_owner_id_fkey ( id, display_name, avatar_url ), created_at')
    .single() as { data: GoalRow | null; error: unknown }

  if (error || !data) {
    console.error('[goals POST] error:', error)
    return NextResponse.json({ error: 'Error al crear la meta' }, { status: 500 })
  }

  return NextResponse.json({
    goal: { ...data, owner: data.owner, task_count: 0, task_done: 0 },
  }, { status: 201 })
}

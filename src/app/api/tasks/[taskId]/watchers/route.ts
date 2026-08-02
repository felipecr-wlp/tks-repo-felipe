/**
 * GET  /api/tasks/[taskId]/watchers, lista los seguidores de la tarea + si YO sigo.
 * POST /api/tasks/[taskId]/watchers, alterna (toggle) MI propio seguimiento.
 *
 * Seguir una tarea = recibir una notificacion en la bandeja cada vez que la tarea
 * se actualiza, aunque no seas el asignado. Circuito B10 (paridad ClickUp/Notion).
 *
 * Anti-IDOR en capas:
 *  1. rate limit.
 *  2. auth 401.
 *  3. admin client (ignora RLS) + re-chequeo de membresia via checkTaskAccess (403/404).
 *  4. profile_id se toma SIEMPRE del usuario autenticado, nunca del body.
 *  5. project_id se deriva de la tarea (server), nunca del body.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { checkTaskAccess } from '@/lib/task-access'
import type { Database } from '@/lib/supabase/types'

interface RouteParams {
  params: { taskId: string }
}

type Member = { id: string; display_name: string; avatar_url: string | null }

async function listWatchers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  taskId: string,
): Promise<Member[]> {
  type Row = { profile: Member | null }
  const { data } = await admin
    .from('task_watchers')
    .select('profile:profiles ( id, display_name, avatar_url )')
    .eq('task_id', taskId)
    .order('created_at', { ascending: true }) as { data: Row[] | null }
  return (data ?? []).map(r => r.profile).filter((p): p is Member => p != null)
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    )
  }

  const watchers = await listWatchers(admin, params.taskId)
  return NextResponse.json({ watchers, watching: watchers.some(w => w.id === user.id) })
}

// ── POST: toggle de MI propio seguimiento ─────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    )
  }

  // ¿Ya sigo? Toggle idempotente.
  const { data: existing } = await admin
    .from('task_watchers')
    .select('id')
    .eq('task_id', params.taskId)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { id: string } | null }

  const db = admin

  if (existing) {
    const { error } = await db.from('task_watchers').delete().eq('id', existing.id)
    if (error) {
      console.error('[task watchers POST] delete error:', error)
      return NextResponse.json({ error: 'Error al dejar de seguir' }, { status: 500 })
    }
  } else {
    // access.projectId es no-nulo tras el guard !access.ok de arriba
    const watcherPayload = {
      task_id:    params.taskId,
      project_id: access.projectId!,
      profile_id: user.id,
    } satisfies Database['public']['Tables']['task_watchers']['Insert']
    // as never: pitfall conocido de @supabase/ssr donde el parametro de escritura colapsa a never
    const { error } = await db.from('task_watchers').insert(watcherPayload as never)
    if (error) {
      console.error('[task watchers POST] insert error:', error)
      return NextResponse.json({ error: 'Error al seguir la tarea' }, { status: 500 })
    }
  }

  const watchers = await listWatchers(admin, params.taskId)
  return NextResponse.json(
    { watchers, watching: watchers.some(w => w.id === user.id) },
    { status: existing ? 200 : 201 },
  )
}

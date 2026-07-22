/**
 * GET  /api/tasks/[taskId]/mentions, Miembros mencionables (solo del proyecto).
 * POST /api/tasks/[taskId]/mentions, Registra menciones y notifica.
 *
 * Body POST: { mentioned_ids: string[], source: 'comment' | 'description' }
 *
 * Seguridad:
 *  - Auth + membresia del proyecto (anti-IDOR: taskId de la ruta).
 *  - Menciones SOLO a miembros reales del proyecto (se filtran server-side; nunca
 *    se confia en la lista del cliente).
 *  - Cada mencion crea una notificacion tipo TASK_MENTIONED para el mencionado
 *    (que la ve en su Bandeja). No se notifica al autor si se auto-menciona.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, createNotification, ActivityVerbs, NotificationTypes } from '@/lib/activity'

const schema = z.object({
  mentioned_ids: z.array(z.string().uuid()).min(1).max(20),
  source: z.enum(['comment', 'description']),
}).strict()

type TaskRow = { project_id: string; workspace_id: string; title: string | null }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function loadTaskWithAccess(admin: any, taskId: string, userId: string): Promise<{ task: TaskRow | null; isMember: boolean }> {
  const { data: task } = await admin
    .from('tasks')
    .select('project_id, workspace_id, title')
    .eq('id', taskId)
    .maybeSingle() as { data: TaskRow | null }
  if (!task) return { task: null, isMember: false }

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', task.project_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null }
  return { task, isMember: !!membership }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { task, isMember } = await loadTaskWithAccess(admin, params.taskId, user.id)
  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })
  if (!isMember) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  type MemberRow = { profile: { id: string; display_name: string | null; avatar_url: string | null } | null }
  const { data: members } = await admin
    .from('project_members')
    .select('profile:profiles ( id, display_name, avatar_url )')
    .eq('project_id', task.project_id) as { data: MemberRow[] | null }

  const list = (members ?? [])
    .filter(m => m.profile != null)
    .map(m => ({ id: m.profile!.id, display_name: m.profile!.display_name ?? 'Miembro', avatar_url: m.profile!.avatar_url }))

  return NextResponse.json(list)
}

export async function POST(
  request: NextRequest,
  { params }: { params: { taskId: string } }
) {
  if (!isUuid(params.taskId)) {
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
  const { task, isMember } = await loadTaskWithAccess(admin, params.taskId, user.id)
  if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })
  if (!isMember) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Filtrar a miembros REALES del proyecto (nunca confiar en el cliente).
  const uniqueIds = Array.from(new Set(parsed.data.mentioned_ids)).filter(id => id !== user.id)
  if (uniqueIds.length === 0) return NextResponse.json({ mentioned: [] })

  const { data: validMembers } = await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', task.project_id)
    .in('profile_id', uniqueIds) as { data: { profile_id: string }[] | null }

  const validIds = (validMembers ?? []).map(m => m.profile_id)
  if (validIds.length === 0) return NextResponse.json({ mentioned: [] })

  // Insertar menciones (idempotente por corrida; duplicados historicos permitidos).
  const rows = validIds.map(id => ({
    task_id:      params.taskId,
    mentioned_id: id,
    mentioned_by: user.id,
    source:       parsed.data.source,
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insErr } = await (admin as any).from('task_mentions').insert(rows)
  if (insErr) {
    console.error('[mentions POST] insert error:', insErr)
    return NextResponse.json({ error: 'Error al registrar las menciones' }, { status: 500 })
  }

  // Notificar a cada mencionado (Bandeja) + registrar actividad.
  await Promise.all(validIds.map(async (recipientId) => {
    await createNotification({
      recipient_id: recipientId,
      subject_id:   user.id,
      type:         NotificationTypes.TASK_MENTIONED,
      object_type:  'task',
      object_id:    params.taskId,
      object_title: task.title ?? undefined,
      workspace_id: task.workspace_id,
    })
  }))

  await logActivity({
    verb:         ActivityVerbs.TASK_MENTIONED,
    subject_id:   user.id,
    object_type:  'task',
    object_id:    params.taskId,
    object_title: task.title ?? undefined,
    workspace_id: task.workspace_id,
    project_id:   task.project_id,
    metadata:     { mentioned_ids: validIds, source: parsed.data.source },
  })

  return NextResponse.json({ mentioned: validIds })
}

/**
 * GET /api/cron/due-reminders
 *
 * Recordatorio diario de fechas de entrega. Recorre las tareas activas con
 * asignado y fecha, y notifica al asignado cuando la tarea esta VENCIDA
 * (task_overdue) o VENCE HOY / dentro de 24h (task_due_soon).
 *
 * Idempotente por dia: antes de insertar, deduplica contra notificaciones del
 * mismo tipo+tarea+destinatario creadas en las ultimas 20 horas, para que una
 * corrida repetida (o dos crons el mismo dia) no genere spam.
 *
 * Seguridad: CRON_SECRET es OBLIGATORIO. Sin la variable el endpoint falla
 * cerrado (503); con ella se exige `Authorization: Bearer <CRON_SECRET>`
 * (Vercel Cron lo envia automaticamente cuando la variable esta configurada).
 *
 * Se programa en vercel.json. No rompe nada existente: solo lee tasks y escribe
 * en notifications reutilizando el modelo ya presente.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NotificationTypes } from '@/lib/activity'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getClient(): any {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Fail-fast: el cron necesita service role; con anon key fallaría contra RLS.
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurada (requerida por el cron).')
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

type TaskRow = {
  id: string
  title: string
  due_date: string | null
  assignee_id: string | null
  workspace_id: string
  status: { category: string } | null
}

type NotifRow = { recipient_id: string; object_id: string | null; type: string }

export async function GET(request: NextRequest) {
  // ── Auth obligatoria por secreto ───────────────────────────────────────────
  // Antes el secreto era opcional y sin CRON_SECRET el endpoint quedaba abierto
  // operando con service role. Ahora falla cerrado: sin la variable, 503 con
  // mensaje claro (configurar CRON_SECRET en Vercel; Vercel Cron manda el
  // header Authorization automáticamente cuando la variable existe).
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[due-reminders] CRON_SECRET no configurado; se rechaza la ejecución.')
    return NextResponse.json(
      { error: 'Cron no configurado: falta CRON_SECRET en el entorno.' },
      { status: 503 }
    )
  }
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const supabase = getClient()
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  // ── Tareas activas, con asignado y fecha, que vencen dentro de 24h o antes ──
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, due_date, assignee_id, workspace_id, status:task_statuses ( category )')
    .eq('is_archived', false)
    .not('assignee_id', 'is', null)
    .not('due_date', 'is', null)
    .lte('due_date', in24h.toISOString()) as { data: TaskRow[] | null; error: unknown }

  if (error) {
    return NextResponse.json({ error: 'Error al leer tareas' }, { status: 500 })
  }

  // Excluir las ya completadas y clasificar overdue vs due_soon.
  const candidates = (tasks ?? []).filter(
    t => t.status?.category !== 'done' && t.assignee_id && t.due_date
  )

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, created: 0 })
  }

  // ── Dedup: notificaciones recordatorio de las ultimas 20h ───────────────────
  const since = new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await supabase
    .from('notifications')
    .select('recipient_id, object_id, type')
    .in('type', [NotificationTypes.TASK_OVERDUE, NotificationTypes.TASK_DUE_SOON])
    .gte('created_at', since) as { data: NotifRow[] | null; error: unknown }

  const seen = new Set(
    (recent ?? []).map(n => `${n.recipient_id}:${n.object_id}:${n.type}`)
  )

  // ── Construir filas a insertar ──────────────────────────────────────────────
  const rows: Record<string, unknown>[] = []
  for (const t of candidates) {
    const due = new Date(t.due_date!)
    const type = due < now ? NotificationTypes.TASK_OVERDUE : NotificationTypes.TASK_DUE_SOON
    const key = `${t.assignee_id}:${t.id}:${type}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      workspace_id: t.workspace_id,
      recipient_id: t.assignee_id,
      subject_id:   null, // recordatorio del sistema, sin actor
      type,
      object_type:  'task',
      object_id:    t.id,
      object_title: t.title,
    })
  }

  let created = 0
  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('notifications').insert(rows)
    if (insErr) {
      return NextResponse.json({ error: 'Error al crear notificaciones' }, { status: 500 })
    }
    created = rows.length
  }

  return NextResponse.json({ ok: true, scanned: candidates.length, created })
}

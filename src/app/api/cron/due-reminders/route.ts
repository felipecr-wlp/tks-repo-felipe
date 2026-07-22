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
import { NotificationTypes, notify } from '@/lib/activity'
import { runAutomations } from '@/lib/automations'
import { safeEqual } from '@/lib/secure-compare'

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
  project_id: string
  priority: string
  status_id: string | null
  status: { category: string } | null
}

type NotifRow = { recipient_id: string; object_id: string | null; type: string }

type ReminderRow = {
  id: string
  workspace_id: string | null
  creator_id: string
  target_id: string
  body: string | null
  remind_at: string
}

/**
 * Segundo barrido del cron: recordatorios programados desde el chat (Circuito
 * 1.C). Entrega los que ya vencieron (status 'pending' y remind_at <= now) al
 * inbox via notify() (y por correo si el tipo lo amerita y el destinatario no
 * opto por salirse), luego los marca 'sent'. Best effort; nunca lanza.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function deliverReminders(supabase: any, nowIso: string): Promise<number> {
  const { data: due } = await supabase
    .from('reminders')
    .select('id, workspace_id, creator_id, target_id, body, remind_at')
    .eq('status', 'pending')
    .lte('remind_at', nowIso)
    .limit(500) as { data: ReminderRow[] | null; error: unknown }

  const list = due ?? []
  if (list.length === 0) return 0

  const deliveredIds: string[] = []
  for (const r of list) {
    if (!r.workspace_id) { deliveredIds.push(r.id); continue } // sin workspace: solo sella
    await notify({
      recipient_id: r.target_id,
      subject_id:   r.creator_id,
      type:         NotificationTypes.REMINDER,
      object_type:  'reminder',
      object_id:    r.id,
      object_title: (r.body && r.body.trim().length > 0) ? r.body.trim() : 'Recordatorio',
      workspace_id: r.workspace_id,
    })
    deliveredIds.push(r.id)
  }

  if (deliveredIds.length > 0) {
    await supabase
      .from('reminders')
      .update({ status: 'sent', sent_at: nowIso })
      .in('id', deliveredIds)
  }
  return deliveredIds.length
}

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
  if (!safeEqual(auth ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const supabase = getClient()
  const now = new Date()
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000)

  // ── Recordatorios del chat (Circuito 1.C) ───────────────────────────────────
  // Corre siempre, independiente de las tareas por vencer.
  let remindersSent = 0
  try {
    remindersSent = await deliverReminders(supabase, now.toISOString())
  } catch (e) {
    console.error('[due-reminders] error entregando recordatorios:', e)
  }

  // ── Tareas activas, con asignado y fecha, que vencen dentro de 24h o antes ──
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('id, title, due_date, assignee_id, workspace_id, project_id, priority, status_id, status:task_statuses ( category )')
    .eq('is_archived', false)
    .not('assignee_id', 'is', null)
    .not('due_date', 'is', null)
    .lte('due_date', in24h.toISOString())
    // Cota dura: sin limite este barrido crecia sin techo (toda tarea vencida o
    // por vencer en la instancia) y podia agotar memoria o el maxDuration de 30s.
    // Se prioriza lo mas vencido (due_date ascendente) y se topa en 5000.
    .order('due_date', { ascending: true })
    .limit(5000) as { data: TaskRow[] | null; error: unknown }

  if (error) {
    return NextResponse.json({ error: 'Error al leer tareas' }, { status: 500 })
  }

  // ── Automatizaciones por vencimiento (Circuito 3.B) ─────────────────────────
  // Dispara reglas con trigger 'due' para tareas que ACABAN de vencer desde la
  // ultima corrida (due_date pasada pero dentro de las ultimas 24h). La ventana
  // coincide con la cadencia diaria del cron, dando un disparo UNICO por tarea
  // (evita re-ejecutar la regla cada dia). Corre aunque la tarea no tenga
  // asignado (una regla podria asignarla). Best effort.
  let dueAutomations = 0
  try {
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    const justDue = (tasks ?? []).filter(t =>
      t.status?.category !== 'done' &&
      t.due_date != null &&
      new Date(t.due_date) <= now &&
      new Date(t.due_date) > dayAgo
    )
    for (const t of justDue) {
      await runAutomations({
        admin: supabase,
        event: 'due',
        actorId: null,
        task: {
          id: t.id,
          project_id: t.project_id,
          workspace_id: t.workspace_id,
          title: t.title,
          status_id: t.status_id,
          assignee_id: t.assignee_id,
          priority: t.priority,
          due_date: t.due_date,
        },
      })
      dueAutomations++
    }
  } catch (e) {
    console.error('[due-reminders] error corriendo automatizaciones due:', e)
  }

  // Excluir las ya completadas y clasificar overdue vs due_soon.
  const candidates = (tasks ?? []).filter(
    t => t.status?.category !== 'done' && t.assignee_id && t.due_date
  )

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, created: 0, remindersSent, dueAutomations })
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

  return NextResponse.json({ ok: true, scanned: candidates.length, created, remindersSent, dueAutomations })
}

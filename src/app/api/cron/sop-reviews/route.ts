/**
 * GET /api/cron/sop-reviews
 *
 * Recordatorio diario de revision de SOPs. Recorre los documentos operativos
 * (doc_kind <> 'note') con fecha de revision (`review_due`) y notifica al OWNER
 * del documento (created_by) cuando la revision esta VENCIDA (sop_review_overdue)
 * o VENCE dentro de 7 dias (sop_review_due_soon). Los SOP marcados 'obsolete' se
 * omiten (ya no se mantienen).
 *
 * Idempotente por dia: antes de insertar, deduplica contra notificaciones del
 * mismo tipo+nota+destinatario creadas en las ultimas 20 horas, para que una
 * corrida repetida no genere spam.
 *
 * Seguridad: CRON_SECRET es OBLIGATORIO. Sin la variable el endpoint falla
 * cerrado (503); con ella se exige `Authorization: Bearer <CRON_SECRET>`
 * (Vercel Cron lo envia automaticamente cuando la variable esta configurada).
 *
 * Se programa en vercel.json. Reutiliza el modelo de notifications ya presente;
 * cierra el ciclo de gobernanza que en Fase B quedo como MVP visual (solo se
 * resaltaba en rojo la revision vencida en la lente de SOPs).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NotificationTypes } from '@/lib/activity'
import { safeEqual } from '@/lib/secure-compare'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getClient(): any {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurada (requerida por el cron).')
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

type SopRow = {
  id: string
  title: string
  review_due: string | null   // fecha ISO (YYYY-MM-DD)
  sop_status: string | null
  created_by: string | null
  workspace_id: string
}

type NotifRow = { recipient_id: string; object_id: string | null; type: string }

// Fecha local del servidor como YYYY-MM-DD (review_due es un `date`, sin hora).
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function GET(request: NextRequest) {
  // ── Auth obligatoria por secreto ───────────────────────────────────────────
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[sop-reviews] CRON_SECRET no configurado; se rechaza la ejecución.')
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
  const today = new Date()
  const todayIso = isoDate(today)
  const in7dIso = isoDate(new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000))

  // ── Documentos operativos con owner y fecha de revision <= hoy+7d ────────────
  const { data: sops, error } = await supabase
    .from('notes')
    .select('id, title, review_due, sop_status, created_by, workspace_id')
    .neq('doc_kind', 'note')
    .not('review_due', 'is', null)
    .not('created_by', 'is', null)
    .lte('review_due', in7dIso)
    // Cota dura: sin limite este barrido crecia sin techo (todo SOP con revision
    // vencida o proxima en la instancia) y podia agotar memoria o el maxDuration
    // de 30s. Se prioriza lo mas vencido (review_due ascendente) y se topa en 5000.
    .order('review_due', { ascending: true })
    .limit(5000) as { data: SopRow[] | null; error: unknown }

  if (error) {
    return NextResponse.json({ error: 'Error al leer SOPs' }, { status: 500 })
  }

  // Excluir obsoletos (ya no se mantienen).
  const candidates = (sops ?? []).filter(
    s => s.sop_status !== 'obsolete' && s.created_by && s.review_due
  )

  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, created: 0 })
  }

  // ── Dedup: notificaciones de revision de las ultimas 20h ────────────────────
  const since = new Date(today.getTime() - 20 * 60 * 60 * 1000).toISOString()
  const { data: recent } = await supabase
    .from('notifications')
    .select('recipient_id, object_id, type')
    .in('type', [NotificationTypes.SOP_REVIEW_OVERDUE, NotificationTypes.SOP_REVIEW_DUE_SOON])
    .gte('created_at', since)
    // Cota dura al set de dedup: coherente con el limite del barrido de arriba.
    .limit(10000) as { data: NotifRow[] | null; error: unknown }

  const seen = new Set(
    (recent ?? []).map(n => `${n.recipient_id}:${n.object_id}:${n.type}`)
  )

  // ── Construir filas a insertar ──────────────────────────────────────────────
  const rows: Record<string, unknown>[] = []
  for (const s of candidates) {
    const type = s.review_due! < todayIso
      ? NotificationTypes.SOP_REVIEW_OVERDUE
      : NotificationTypes.SOP_REVIEW_DUE_SOON
    const key = `${s.created_by}:${s.id}:${type}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push({
      workspace_id: s.workspace_id,
      recipient_id: s.created_by,
      subject_id:   null, // recordatorio del sistema, sin actor
      type,
      object_type:  'note',
      object_id:    s.id,
      object_title: s.title,
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

/**
 * GET /api/cron/daily-reports
 *
 * Recordatorio de fin de dia: avisa a quien todavia no registro NADA hoy.
 *
 * Decisiones que no son cosmeticas:
 * - Se avisa por AUSENCIA DE ACTIVIDADES, no por reporte sin cerrar. Un dia con
 *   cinco cosas contadas al chat ya cumplio aunque nadie haya apretado "cerrar";
 *   molestar ahi entrena a la gente a ignorar el aviso.
 * - Fines de semana no se corre. Un recordatorio de trabajo el sabado solo
 *   quema la credibilidad del recordatorio del lunes.
 * - Idempotente por dia: se deduplica contra los avisos del mismo tipo de las
 *   ultimas 20 horas, asi una corrida repetida no genera dos notificaciones.
 *
 * El dia se calcula en la zona de reporte (no en la del servidor de Vercel, que
 * corre en UTC): a las 23:00 de Mexico ya es "mañana" en UTC y el barrido
 * revisaria un dia que aun no empieza.
 *
 * Seguridad: identico al resto de los crons. CRON_SECRET obligatorio, falla
 * cerrado (503) si no esta, y exige Authorization: Bearer <CRON_SECRET>.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { NotificationTypes } from '@/lib/activity'
import { safeEqual } from '@/lib/secure-compare'
import { todayInReportTz, isWeekend } from '@/lib/daily-reports'

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

type MemberRow = { workspace_id: string; profile_id: string }
type ReportRow = { id: string; workspace_id: string; profile_id: string }
type EntryRow = { report_id: string }
type NotifRow = { recipient_id: string; type: string }

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error('[daily-reports cron] CRON_SECRET no configurado; se rechaza la ejecución.')
    return NextResponse.json(
      { error: 'Cron no configurado: falta CRON_SECRET en el entorno.' },
      { status: 503 }
    )
  }
  const auth = request.headers.get('authorization')
  if (!safeEqual(auth ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const dia = todayInReportTz()
  if (isWeekend(dia)) {
    return NextResponse.json({ ok: true, skipped: 'weekend', date: dia })
  }

  const supabase = getClient()

  // ── Todas las membresias activas ───────────────────────────────────────────
  const { data: members, error: memErr } = (await supabase
    .from('workspace_members')
    .select('workspace_id, profile_id')
    .limit(5000)) as { data: MemberRow[] | null; error: unknown }

  if (memErr) {
    return NextResponse.json({ error: 'Error al leer miembros' }, { status: 500 })
  }
  if (!members || members.length === 0) {
    return NextResponse.json({ ok: true, date: dia, scanned: 0, created: 0 })
  }

  // ── Reportes de hoy y cuales tienen al menos una actividad ─────────────────
  const { data: reports } = (await supabase
    .from('daily_reports')
    .select('id, workspace_id, profile_id')
    .eq('report_date', dia)
    .limit(5000)) as { data: ReportRow[] | null; error: unknown }

  const conActividad = new Set<string>()
  if (reports && reports.length > 0) {
    // Una sola consulta para todas las actividades del dia: preguntar reporte
    // por reporte convertiria el barrido en cientos de viajes a la base.
    const { data: entries } = (await supabase
      .from('daily_report_entries')
      .select('report_id')
      .in(
        'report_id',
        reports.map(r => r.id)
      )
      .limit(20000)) as { data: EntryRow[] | null; error: unknown }

    const reportIdsConEntrada = new Set((entries ?? []).map(e => e.report_id))
    for (const r of reports) {
      if (reportIdsConEntrada.has(r.id)) conActividad.add(`${r.workspace_id}:${r.profile_id}`)
    }
  }

  const faltantes = members.filter(m => !conActividad.has(`${m.workspace_id}:${m.profile_id}`))
  if (faltantes.length === 0) {
    return NextResponse.json({ ok: true, date: dia, scanned: members.length, created: 0 })
  }

  // ── Dedup: avisos del mismo tipo en las ultimas 20 horas ───────────────────
  const since = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString()
  const { data: recent } = (await supabase
    .from('notifications')
    .select('recipient_id, type')
    .eq('type', NotificationTypes.DAILY_REPORT_MISSING)
    .gte('created_at', since)
    .limit(10000)) as { data: NotifRow[] | null; error: unknown }

  const yaAvisados = new Set((recent ?? []).map(n => n.recipient_id))

  const rows = faltantes
    .filter(m => !yaAvisados.has(m.profile_id))
    .map(m => ({
      workspace_id: m.workspace_id,
      recipient_id: m.profile_id,
      subject_id: null, // recordatorio del sistema, sin actor
      type: NotificationTypes.DAILY_REPORT_MISSING,
      object_type: 'daily_report',
      object_id: null,
      // El dia viaja en el titulo: el reporte todavia no existe, asi que no hay
      // uuid que apuntar. La bandeja lo usa para abrir el dia correcto.
      object_title: dia,
    }))

  let created = 0
  if (rows.length > 0) {
    const { error: insErr } = await supabase.from('notifications').insert(rows)
    if (insErr) {
      console.error('[daily-reports cron] insert error:', insErr)
      return NextResponse.json({ error: 'Error al crear notificaciones' }, { status: 500 })
    }
    created = rows.length
  }

  return NextResponse.json({ ok: true, date: dia, scanned: members.length, created })
}

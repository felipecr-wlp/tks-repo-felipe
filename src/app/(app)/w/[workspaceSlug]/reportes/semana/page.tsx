/**
 * La semana de la bitacora.
 *
 * El reporte diario contestaba bien "que hice hoy" y muy mal las dos preguntas
 * que de verdad se hacen el viernes: "que hice esta semana" y "quien viene
 * arrastrando un bloqueo desde el martes". Con solo la vista de dia habia que
 * abrir siete pantallas y acordarse de lo leido, que es otra forma de decir que
 * nadie lo hacia.
 *
 * Esta pantalla es de LECTURA. No registra, no edita y no firma imagenes: una
 * semana de un equipo son decenas de miniaturas que casi nadie mira, y firmarlas
 * aqui gastaria egress para nada. Para eso esta la vista de dia, a un clic de
 * cada celda.
 *
 * Hereda la misma regla de privacidad que la vista de dia (`isReportSupervisor`)
 * y, como alli, el filtro se aplica en la CONSULTA y no al pintar: filtrar en el
 * cliente dejaria los reportes ajenos igual de visibles en el HTML.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { todayInReportTz, isValidReportDate, reportWeekDays } from '@/lib/daily-reports'
import { isReportSupervisor } from '@/lib/daily-report-access'
import { SemanaClient, type FilaSemana, type BloqueoSemana } from './SemanaClient'

export const metadata = { title: 'Semana · Reporte diario · WLO' }

interface PageProps {
  params: { workspaceSlug: string }
  searchParams: { d?: string }
}

export default async function SemanaPage({ params, searchParams }: PageProps) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  type WsFromMember = { workspaces: { id: string; name: string } | null }
  const { data: row } = (await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle()) as { data: WsFromMember | null; error: unknown }

  const workspace = row?.workspaces
  if (!workspace) redirect('/')

  const ancla = searchParams.d && isValidReportDate(searchParams.d) ? searchParams.d : todayInReportTz()
  const dias = reportWeekDays(ancla)

  const isSupervisor = await isReportSupervisor(admin, workspace.id, user.id)

  // ── Reportes de la semana ──────────────────────────────────────────────────
  type ReportRow = {
    id: string
    profile_id: string
    report_date: string
    summary: string | null
    status: string
    profile: { id: string; display_name: string; avatar_url: string | null } | null
  }
  let reportQuery = admin
    .from('daily_reports')
    .select('id, profile_id, report_date, summary, status, profile:profiles ( id, display_name, avatar_url )')
    .eq('workspace_id', workspace.id)
    .gte('report_date', dias[0])
    .lte('report_date', dias[6])
  if (!isSupervisor) reportQuery = reportQuery.eq('profile_id', user.id)

  const { data: reportRows } = (await reportQuery.limit(500)) as { data: ReportRow[] | null; error: unknown }
  const reports = reportRows ?? []

  // ── Actividades de la semana, en UNA consulta ──────────────────────────────
  // No se traen los textos de todo: de una semana de doce personas solo interesa
  // CUANTAS actividades hubo por dia y QUE bloqueos hubo. El contenido completo
  // vive en la vista de dia.
  type EntryRow = {
    report_id: string
    content: string
    category: string
    created_at: string
    resolved_at: string | null
  }
  let entries: EntryRow[] = []
  if (reports.length > 0) {
    const { data } = (await admin
      .from('daily_report_entries')
      .select('report_id, content, category, created_at, resolved_at')
      .in(
        'report_id',
        reports.map(r => r.id)
      )
      .order('created_at', { ascending: true })
      .limit(3000)) as { data: EntryRow[] | null; error: unknown }
    entries = data ?? []
  }

  // Solo cuentan los bloqueos que SIGUEN abiertos. Marcar un dia como
  // problematico por algo que ya se destrabo el mismo dia es la forma mas rapida
  // de que la señal deje de mirarse.
  const conteo = new Map<string, { total: number; bloqueos: number }>()
  for (const e of entries) {
    const acc = conteo.get(e.report_id) ?? { total: 0, bloqueos: 0 }
    acc.total += 1
    if (e.category === 'bloqueo' && !e.resolved_at) acc.bloqueos += 1
    conteo.set(e.report_id, acc)
  }

  // ── Personas ───────────────────────────────────────────────────────────────
  // Quien no reporto en toda la semana tambien es una fila: si solo aparecieran
  // los que escribieron, la vista contaria una semana perfecta que no existio.
  type Persona = { id: string; display_name: string; avatar_url: string | null }
  const personas = new Map<string, Persona>()
  for (const r of reports) {
    if (r.profile) personas.set(r.profile.id, r.profile)
  }

  if (isSupervisor) {
    type MemberRow = { profile: { id: string; display_name: string; avatar_url: string | null } | null }
    const { data: memberRows } = (await admin
      .from('workspace_members')
      .select('profile:profiles ( id, display_name, avatar_url )')
      .eq('workspace_id', workspace.id)
      .limit(200)) as { data: MemberRow[] | null; error: unknown }
    for (const m of memberRows ?? []) {
      if (m.profile && !personas.has(m.profile.id)) personas.set(m.profile.id, m.profile)
    }
  } else if (!personas.has(user.id)) {
    // Sin reportes en toda la semana, la persona no saldria ni en su propia
    // pantalla. Se resuelve su nombre para que la fila exista igual.
    const { data: me } = (await admin
      .from('profiles')
      .select('id, display_name, avatar_url')
      .eq('id', user.id)
      .maybeSingle()) as { data: Persona | null }
    if (me) personas.set(me.id, me)
  }

  const porPersonaDia = new Map<string, ReportRow>()
  for (const r of reports) porPersonaDia.set(`${r.profile_id}|${r.report_date}`, r)

  const filas: FilaSemana[] = Array.from(personas.values())
    .map(p => {
      const celdas = dias.map(d => {
        const r = porPersonaDia.get(`${p.id}|${d}`)
        const c = r ? (conteo.get(r.id) ?? { total: 0, bloqueos: 0 }) : null
        return {
          date: d,
          actividades: c?.total ?? 0,
          bloqueos: c?.bloqueos ?? 0,
          status: r ? (r.status === 'submitted' ? ('submitted' as const) : ('draft' as const)) : null,
        }
      })
      return {
        profile_id: p.id,
        display_name: p.display_name,
        avatar_url: p.avatar_url,
        celdas,
        total: celdas.reduce((s, c) => s + c.actividades, 0),
        entregados: celdas.filter(c => c.status === 'submitted').length,
        resumenes: dias
          .map(d => {
            const r = porPersonaDia.get(`${p.id}|${d}`)
            return r?.summary ? { date: d, summary: r.summary } : null
          })
          .filter((x): x is { date: string; summary: string } => !!x),
      }
    })
    // Quien mas reporto arriba, y el propio siempre primero: es el unico que la
    // persona puede corregir.
    .sort((a, b) => {
      if (a.profile_id === user.id) return -1
      if (b.profile_id === user.id) return 1
      if (b.total !== a.total) return b.total - a.total
      return a.display_name.localeCompare(b.display_name, 'es')
    })

  // ── Bloqueos de la semana ──────────────────────────────────────────────────
  // Van arriba y aparte porque son lo unico de esta pantalla que pide una
  // decision. Un bloqueo del martes que sigue ahi el viernes es exactamente el
  // dato que la vista de dia hacia invisible.
  const metaReporte = new Map(reports.map(r => [r.id, r]))
  const todosLosBloqueos = entries.filter(e => e.category === 'bloqueo')
  const bloqueos: BloqueoSemana[] = todosLosBloqueos
    .filter(e => !e.resolved_at)
    .map(e => {
      const r = metaReporte.get(e.report_id)
      if (!r) return null
      return {
        date: r.report_date,
        display_name: r.profile?.display_name ?? 'Sin nombre',
        content: e.content,
      }
    })
    .filter((x): x is BloqueoSemana => !!x)
    // Del mas viejo al mas nuevo: el que lleva mas tiempo detenido es el que hay
    // que mirar primero, no el ultimo que se escribio.
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1))

  const bloqueosResueltos = todosLosBloqueos.length - bloqueos.length

  return (
    <SemanaClient
      workspaceSlug={params.workspaceSlug}
      dias={dias}
      today={todayInReportTz()}
      currentUserId={user.id}
      isSupervisor={isSupervisor}
      filas={filas}
      bloqueos={bloqueos}
      bloqueosResueltos={bloqueosResueltos}
    />
  )
}

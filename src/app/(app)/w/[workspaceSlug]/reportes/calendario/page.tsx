/**
 * El calendario de la bitacora: que se estuvo haciendo, en la temporalidad que
 * uno elija.
 *
 * La vista de dia contesta "que hice hoy" y la de semana "quien entrego". Falta
 * la pregunta de arriba: "que estuvo haciendo esta persona en marzo". Con las
 * dos anteriores habia que abrir treinta pantallas, o sea que nadie lo hacia.
 *
 * Es una pantalla de LECTURA y de FORMA, no de detalle. Cada celda lleva el
 * conteo, los bloqueos abiertos y dos o tres renglones de muestra; el resto esta
 * a un clic, en la vista de dia. Esa decision es la que la hace barata: no se
 * firman imagenes (un trimestre son cientos de miniaturas que nadie mira y cada
 * firma es egress) y de las actividades solo viaja un recorte del texto.
 *
 * PRIVACIDAD: la misma regla del resto de la bitacora, aplicada en la CONSULTA.
 * Quien no es mando solo ve lo suyo, y ni siquiera recibe la lista de miembros:
 * el selector de persona no se pinta porque no hay a quien elegir.
 *
 * El rango va en la URL (?from=&to=) para que un periodo concreto se comparta
 * con un enlace, igual que el dia va en ?d=.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { todayInReportTz, isValidReportDate } from '@/lib/daily-reports'
import { isReportSupervisor } from '@/lib/daily-report-access'
import { CalendarioClient, type DiaCalendario, type MiembroOpcion } from './CalendarioClient'

export const metadata = { title: 'Calendario · Reporte diario · WLO' }

/**
 * Tope duro del rango. Un trimestre cabe; "todo el año" no, y no por gusto: son
 * miles de renglones para pintar un calendario que ya no se lee de un vistazo.
 */
const MAX_DIAS = 92

/** Cuantas actividades se muestran por celda antes de resumir en "+N". */
const MUESTRAS_POR_DIA = 3

/** Recorte del texto. La celda no es para leer, es para reconocer. */
const LARGO_MUESTRA = 80

function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + n)
  return dt.toISOString().slice(0, 10)
}

function diasEntre(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
}

/** Primer y ultimo dia del mes de `iso`. Es el rango por defecto. */
function mesDe(iso: string): { from: string; to: string } {
  const [y, m] = iso.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(ultimo).padStart(2, '0')}` }
}

interface PageProps {
  params: { workspaceSlug: string }
  searchParams: { from?: string; to?: string; p?: string }
}

export default async function CalendarioPage({ params, searchParams }: PageProps) {
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

  const today = todayInReportTz()
  const isSupervisor = await isReportSupervisor(admin, workspace.id, user.id)

  // ── Rango ──────────────────────────────────────────────────────────────────
  // Se sanea aqui y no en el cliente: un `from` invento en la URL no puede
  // convertirse en una consulta de tres años.
  const porDefecto = mesDe(today)
  let from = searchParams.from && isValidReportDate(searchParams.from) ? searchParams.from : porDefecto.from
  let to = searchParams.to && isValidReportDate(searchParams.to) ? searchParams.to : porDefecto.to
  if (from > to) [from, to] = [to, from]
  if (diasEntre(from, to) > MAX_DIAS) to = addDays(from, MAX_DIAS - 1)

  // ── A quien se mira ────────────────────────────────────────────────────────
  // `p=equipo` solo lo puede pedir un mando. Cualquier otro valor que no sea el
  // propio id tambien exige serlo. Sin mando, el alcance es uno mismo y punto.
  let profileId: string | null = user.id
  if (isSupervisor) {
    if (searchParams.p === 'equipo') profileId = null
    else if (searchParams.p) profileId = searchParams.p
    else profileId = user.id
  }

  // ── Reportes del rango ─────────────────────────────────────────────────────
  type ReportRow = {
    id: string
    profile_id: string
    report_date: string
    profile: { id: string; display_name: string } | null
  }
  let q = admin
    .from('daily_reports')
    .select('id, profile_id, report_date, profile:profiles ( id, display_name )')
    .eq('workspace_id', workspace.id)
    .gte('report_date', from)
    .lte('report_date', to)
  if (profileId) q = q.eq('profile_id', profileId)

  const { data: reportRows } = (await q.limit(900)) as { data: ReportRow[] | null; error: unknown }
  const reports = reportRows ?? []

  // ── Actividades, en UNA consulta ───────────────────────────────────────────
  type EntryRow = {
    report_id: string
    content: string
    category: string
    resolved_at: string | null
  }
  let entries: EntryRow[] = []
  if (reports.length > 0) {
    const { data: entryRows } = (await admin
      .from('daily_report_entries')
      .select('report_id, content, category, resolved_at')
      .in(
        'report_id',
        reports.map(r => r.id)
      )
      .order('created_at', { ascending: true })
      .limit(4000)) as { data: EntryRow[] | null; error: unknown }
    entries = entryRows ?? []
  }

  const porReporte = new Map<string, EntryRow[]>()
  for (const e of entries) {
    const lista = porReporte.get(e.report_id) ?? []
    lista.push(e)
    porReporte.set(e.report_id, lista)
  }

  // ── Se arma un objeto por DIA ──────────────────────────────────────────────
  // El calendario se pinta por fecha, asi que la agregacion se hace aqui y no en
  // el navegador: mandar cuatro mil renglones para que el cliente los sume es
  // pagar transferencia por un trabajo que el servidor ya tenia hecho.
  const mapa = new Map<string, DiaCalendario>()
  for (const r of reports) {
    const propias = porReporte.get(r.id) ?? []
    if (propias.length === 0) continue
    const dia = mapa.get(r.report_date) ?? {
      date: r.report_date,
      actividades: 0,
      bloqueosAbiertos: 0,
      personas: 0,
      muestras: [],
    }
    dia.actividades += propias.length
    dia.personas += 1
    for (const e of propias) {
      if (e.category === 'bloqueo' && !e.resolved_at) dia.bloqueosAbiertos += 1
      if (dia.muestras.length < MUESTRAS_POR_DIA) {
        dia.muestras.push({
          category: e.category,
          content: e.content.length > LARGO_MUESTRA ? `${e.content.slice(0, LARGO_MUESTRA)}...` : e.content,
          // El nombre solo importa cuando se miran varias personas a la vez.
          persona: profileId ? null : (r.profile?.display_name ?? null),
        })
      }
    }
    mapa.set(r.report_date, dia)
  }
  const dias = Array.from(mapa.values()).sort((a, b) => a.date.localeCompare(b.date))

  // ── Miembros, solo para mandos ─────────────────────────────────────────────
  let miembros: MiembroOpcion[] = []
  if (isSupervisor) {
    type MemberRow = { profile: { id: string; display_name: string } | null }
    const { data: memberRows } = (await admin
      .from('workspace_members')
      .select('profile:profiles ( id, display_name )')
      .eq('workspace_id', workspace.id)
      .limit(200)) as { data: MemberRow[] | null; error: unknown }
    miembros = (memberRows ?? [])
      .map(m => m.profile)
      .filter((p): p is { id: string; display_name: string } => Boolean(p))
      .map(p => ({ id: p.id, nombre: p.display_name }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }

  return (
    <CalendarioClient
      workspaceId={workspace.id}
      workspaceSlug={params.workspaceSlug}
      from={from}
      to={to}
      today={today}
      currentUserId={user.id}
      isSupervisor={isSupervisor}
      profileId={profileId}
      miembros={miembros}
      dias={dias}
      maxDias={MAX_DIAS}
    />
  )
}

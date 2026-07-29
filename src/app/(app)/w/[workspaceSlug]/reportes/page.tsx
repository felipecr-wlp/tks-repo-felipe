/**
 * Reporte diario de actividades del workspace.
 *
 * Dos preguntas que antes no tenian donde contestarse: "que hice hoy" y "que
 * hizo el equipo el martes". La captura ocurre sobre todo por chat (KERN
 * registra lo que la gente le cuenta); esta pantalla es donde eso se lee,
 * se corrige y se cierra.
 *
 * Server component: resuelve el workspace por membresia (anti-RLS-loop) y trae
 * con el admin client los reportes del dia elegido, sus actividades y la lista
 * de miembros. Los miembros importan tanto como los reportes: la ausencia es
 * informacion, y sin la lista completa no se puede mostrar quien no reporto.
 *
 * El dia se elige por query string (?d=YYYY-MM-DD) y no por estado de cliente,
 * para que un dia concreto se pueda compartir con un enlace.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { todayInReportTz, isValidReportDate } from '@/lib/daily-reports'
import { ReportesClient, type ReporteDia, type MiembroSinReporte } from './ReportesClient'

export const metadata = { title: 'Reporte diario · WLO' }

interface PageProps {
  params: { workspaceSlug: string }
  searchParams: { d?: string }
}

export default async function ReportesPage({ params, searchParams }: PageProps) {
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

  // Una fecha invalida en la URL no es motivo de error: se cae a hoy.
  const dia = searchParams.d && isValidReportDate(searchParams.d) ? searchParams.d : todayInReportTz()

  // ── Reportes del dia ───────────────────────────────────────────────────────
  type ReportRow = {
    id: string
    profile_id: string
    summary: string | null
    status: string
    submitted_at: string | null
    profile: { id: string; display_name: string; avatar_url: string | null } | null
  }
  const { data: reportRows } = (await admin
    .from('daily_reports')
    .select('id, profile_id, summary, status, submitted_at, profile:profiles ( id, display_name, avatar_url )')
    .eq('workspace_id', workspace.id)
    .eq('report_date', dia)
    .limit(200)) as { data: ReportRow[] | null; error: unknown }

  const reports = reportRows ?? []

  // Todas las actividades del dia en UNA consulta. Una por reporte convertiria
  // un equipo de doce personas en doce viajes a la base por cada visita.
  type EntryRow = {
    id: string
    report_id: string
    content: string
    category: string
    minutes: number | null
    source: string
    created_at: string
  }
  let entries: EntryRow[] = []
  if (reports.length > 0) {
    const { data } = (await admin
      .from('daily_report_entries')
      .select('id, report_id, content, category, minutes, source, created_at')
      .in(
        'report_id',
        reports.map(r => r.id)
      )
      .order('created_at', { ascending: true })
      .limit(1000)) as { data: EntryRow[] | null; error: unknown }
    entries = data ?? []
  }

  const byReport = new Map<string, EntryRow[]>()
  for (const e of entries) {
    const list = byReport.get(e.report_id) ?? []
    list.push(e)
    byReport.set(e.report_id, list)
  }

  // ── Miembros del workspace (para saber quien falta) ────────────────────────
  type MemberRow = { profile: { id: string; display_name: string; avatar_url: string | null } | null }
  const { data: memberRows } = (await admin
    .from('workspace_members')
    .select('profile:profiles ( id, display_name, avatar_url )')
    .eq('workspace_id', workspace.id)
    .limit(200)) as { data: MemberRow[] | null; error: unknown }

  const conReporte = new Set(reports.map(r => r.profile_id))
  const sinReporte: MiembroSinReporte[] = (memberRows ?? [])
    .map(m => m.profile)
    .filter((p): p is NonNullable<typeof p> => !!p && !conReporte.has(p.id))
    .map(p => ({ id: p.id, display_name: p.display_name, avatar_url: p.avatar_url }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name, 'es'))

  const dias: ReporteDia[] = reports
    .map(r => ({
      id: r.id,
      profile_id: r.profile_id,
      display_name: r.profile?.display_name ?? 'Sin nombre',
      avatar_url: r.profile?.avatar_url ?? null,
      summary: r.summary,
      status: r.status === 'submitted' ? ('submitted' as const) : ('draft' as const),
      submitted_at: r.submitted_at,
      entries: (byReport.get(r.id) ?? []).map(e => ({
        id: e.id,
        content: e.content,
        category: e.category,
        minutes: e.minutes,
        source: e.source,
        created_at: e.created_at,
      })),
    }))
    // El propio reporte primero: es el unico que la persona puede editar.
    .sort((a, b) => {
      if (a.profile_id === user.id) return -1
      if (b.profile_id === user.id) return 1
      return a.display_name.localeCompare(b.display_name, 'es')
    })

  return (
    <ReportesClient
      workspaceId={workspace.id}
      workspaceSlug={params.workspaceSlug}
      date={dia}
      today={todayInReportTz()}
      currentUserId={user.id}
      reportes={dias}
      sinReporte={sinReporte}
    />
  )
}

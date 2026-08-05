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
import { isReportSupervisor } from '@/lib/daily-report-access'
import { REPORT_IMAGES_BUCKET } from '@/lib/daily-report-images'
import { sanitizeRichText } from '@/lib/sanitize'
import { ReportesClient, type ReporteDia, type MiembroSinReporte } from './ReportesClient'
import type { ReporteImagen } from './ReportImageStrip'

/** Vida de la firma de una miniatura. Alcanza para una jornada de trabajo. */
const THUMB_URL_TTL = 60 * 60 * 4

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

  // ── ¿Puede ver el dia de los demas? ────────────────────────────────────────
  // El reporte diario dejo de ser un tablero abierto. Un reporte que lee todo
  // el mundo se convierte en vitrina: la gente escribe lo que luce bien y deja
  // de anotar lo que la bloquea, que es justo lo unico que sirve leer. Lo ven
  // su dueño y quien tiene que coordinar (mando de la organizacion o del
  // workspace). La misma regla vive en daily-report-access.ts y la aplican
  // tambien las rutas /api y las herramientas de IA.
  const isSupervisor = await isReportSupervisor(admin, workspace.id, user.id)

  // ── Reportes del dia ───────────────────────────────────────────────────────
  type ReportRow = {
    id: string
    profile_id: string
    summary: string | null
    status: string
    submitted_at: string | null
    profile: { id: string; display_name: string; avatar_url: string | null } | null
  }
  // El filtro por persona se aplica en la CONSULTA, no al pintar. Traer los
  // reportes de todos y ocultarlos en el cliente los dejaria igual de visibles
  // en el HTML que viaja al navegador.
  let reportQuery = admin
    .from('daily_reports')
    .select('id, profile_id, summary, status, submitted_at, profile:profiles ( id, display_name, avatar_url )')
    .eq('workspace_id', workspace.id)
    .eq('report_date', dia)
  if (!isSupervisor) reportQuery = reportQuery.eq('profile_id', user.id)

  const { data: reportRows } = (await reportQuery.limit(200)) as {
    data: ReportRow[] | null
    error: unknown
  }

  const reports = reportRows ?? []

  // Todas las actividades del dia en UNA consulta. Una por reporte convertiria
  // un equipo de doce personas en doce viajes a la base por cada visita.
  //
  // La tarea viaja como embed y no como consulta aparte: `task_id` es el UNICO
  // camino entre daily_report_entries y tasks, asi que PostgREST lo resuelve sin
  // ambiguedad (si algun dia hay un segundo camino, esto responderia HTTP 300).
  type EntryRow = {
    id: string
    report_id: string
    content: string
    category: string
    minutes: number | null
    source: string
    created_at: string
    resolved_at: string | null
    details: string | null
    task: { id: string; title: string } | null
  }
  let entries: EntryRow[] = []
  if (reports.length > 0) {
    // `details` viaja completo y no un booleano "tiene detalle". Es HTML corto
    // (techo de 20k y en la practica un par de renglones) y el caso normal es
    // abrir la actividad para leerlo: pedirlo aparte al hacer clic seria una
    // vuelta a la base para mostrar algo que ya cabia aqui.
    const { data } = (await admin
      .from('daily_report_entries')
      .select(
        'id, report_id, content, category, minutes, source, created_at, resolved_at, details, task:tasks ( id, title )'
      )
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

  // ── Evidencia en imagen ────────────────────────────────────────────────────
  // Solo se firman MINIATURAS, y todas en UNA sola llamada. Firmar una por una
  // seria una peticion por imagen; y firmar los originales aqui haria que el
  // navegador se bajara varios megabytes que casi nadie va a mirar. El original
  // se firma cuando alguien hace clic (GET /api/daily-reports/images/[id]).
  type ImageRow = {
    id: string
    entry_id: string
    thumb_path: string
    width: number | null
    height: number | null
    caption: string | null
  }
  const byEntry = new Map<string, ReporteImagen[]>()
  if (entries.length > 0) {
    const { data: imageRows } = (await admin
      .from('daily_report_images')
      .select('id, entry_id, thumb_path, width, height, caption')
      .in(
        'entry_id',
        entries.map(e => e.id)
      )
      .order('created_at', { ascending: true })
      .limit(1000)) as { data: ImageRow[] | null; error: unknown }

    const imgs = imageRows ?? []
    if (imgs.length > 0) {
      const { data: signed } = await admin.storage
        .from(REPORT_IMAGES_BUCKET)
        .createSignedUrls(
          imgs.map(i => i.thumb_path),
          THUMB_URL_TTL
        )

      // createSignedUrls responde en el MISMO orden que se pidio, pero se
      // empareja por path y no por indice: si una firma falla, emparejar por
      // posicion le pondria a una imagen la miniatura de otra.
      const urlByPath = new Map<string, string>()
      for (const s of signed ?? []) {
        if (s.path && s.signedUrl) urlByPath.set(s.path, s.signedUrl)
      }

      for (const i of imgs) {
        const list = byEntry.get(i.entry_id) ?? []
        list.push({
          id: i.id,
          thumb_url: urlByPath.get(i.thumb_path) ?? null,
          width: i.width,
          height: i.height,
          caption: i.caption,
        })
        byEntry.set(i.entry_id, list)
      }
    }
  }

  // ── Miembros del workspace (para saber quien falta) ────────────────────────
  // La ausencia tambien es informacion sobre otras personas: quien no puede ver
  // los reportes ajenos tampoco tiene por que enterarse de quien no entrego.
  let sinReporte: MiembroSinReporte[] = []
  if (isSupervisor) {
    type MemberRow = { profile: { id: string; display_name: string; avatar_url: string | null } | null }
    const { data: memberRows } = (await admin
      .from('workspace_members')
      .select('profile:profiles ( id, display_name, avatar_url )')
      .eq('workspace_id', workspace.id)
      .limit(200)) as { data: MemberRow[] | null; error: unknown }

    const conReporte = new Set(reports.map(r => r.profile_id))
    sinReporte = (memberRows ?? [])
      .map(m => m.profile)
      .filter((p): p is NonNullable<typeof p> => !!p && !conReporte.has(p.id))
      .map(p => ({ id: p.id, display_name: p.display_name, avatar_url: p.avatar_url }))
      .sort((a, b) => a.display_name.localeCompare(b.display_name, 'es'))
  }

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
        resolved_at: e.resolved_at,
        // Se sanea AL LEER y no solo al escribir. Lo guardado ya paso por el
        // saneador, pero esta es la barrera que sigue en pie si mañana alguien
        // mete detalle por otra puerta (una migracion, un script, una ruta
        // nueva) y se olvida de sanear. Es el mismo criterio que usa el resumen.
        details: e.details ? sanitizeRichText(e.details) : null,
        task: e.task ?? null,
        images: byEntry.get(e.id) ?? [],
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
      isSupervisor={isSupervisor}
      reportes={dias}
      sinReporte={sinReporte}
    />
  )
}

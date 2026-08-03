/**
 * Solicitudes a departamentos: pedir algo y que la decisión quede escrita.
 *
 * Server component. Trae el TABLERO (la fila de cada solicitud) y nada mas. El
 * hilo, los involucrados y los adjuntos se piden al abrir una
 * (GET /api/tickets/[id]), porque cargarlos por si acaso son cientos de filas
 * que casi nadie mira.
 *
 * ── Que se ve y que no ──────────────────────────────────────────────────────
 * El filtro va en la CONSULTA, nunca al pintar. Es la misma leccion del reporte
 * diario: todas las rutas /api usan service role y se saltan RLS, asi que
 * esconder una tarjeta en el cliente deja los datos viajando igual. `idsVisibles`
 * devuelve los ids por los cinco motivos nombrables, o `null` si la persona es
 * mando (y entonces no hay filtro que aplicar).
 */
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { idsVisibles, esMando } from '@/lib/tickets/acceso'
import { SolicitudesClient, type Solicitud, type Persona, type Departamento } from './SolicitudesClient'

/** Techo del tablero. Mas que esto no se revisa de un vistazo. */
const MAX_SOLICITUDES = 200

export const metadata = { title: 'Solicitudes · WLO' }

interface PageProps {
  params: { workspaceSlug: string }
  searchParams: { s?: string }
}

export default async function SolicitudesPage({ params, searchParams }: PageProps) {
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

  const [visibles, soyMando] = await Promise.all([
    idsVisibles(admin, workspace.id, user.id),
    esMando(admin, workspace.id, user.id),
  ])

  type TicketRow = {
    id: string
    numero: number
    title: string
    body: string | null
    kind: string
    priority: string
    status: string
    space_id: string | null
    requested_by: string | null
    assignee_id: string | null
    needed_by: string | null
    due_date: string | null
    links: unknown
    attachments: unknown
    decision_note: string | null
    created_at: string
    closed_at: string | null
    solicitante: { id: string; display_name: string; avatar_url: string | null } | null
    responsable: { id: string; display_name: string; avatar_url: string | null } | null
    depto: { id: string; name: string; color: string | null; icon: string | null } | null
  }

  // Los embeds NOMBRAN la constraint a proposito: `tickets` tiene tres claves
  // foraneas a profiles (quien pidio, quien hace, quien decidio). Sin nombrarla,
  // PostgREST no sabe cual quiere y responde 300 a la consulta entera.
  let query = admin
    .from('tickets')
    .select(
      'id, numero, title, body, kind, priority, status, space_id, requested_by, assignee_id, needed_by, due_date, links, attachments, decision_note, created_at, closed_at,' +
        ' solicitante:profiles!tickets_requested_by_fkey ( id, display_name, avatar_url ),' +
        ' responsable:profiles!tickets_assignee_id_fkey ( id, display_name, avatar_url ),' +
        ' depto:spaces!tickets_space_id_fkey ( id, name, color, icon )',
    )
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })
    .limit(MAX_SOLICITUDES)

  // `null` significa "todas" (es mando). Un arreglo vacio significa "ninguna", y
  // hay que respetarlo: tratarlo como "sin filtro" abriria el tablero entero a
  // quien no tiene ni un motivo para ver nada.
  if (visibles !== null) {
    if (visibles.length === 0) {
      return (
        <SolicitudesClient
          workspaceId={workspace.id}
          workspaceSlug={params.workspaceSlug}
          currentUserId={user.id}
          soyMando={false}
          solicitudesIniciales={[]}
          departamentos={await cargarDepartamentos(admin, workspace.id)}
          personas={await cargarPersonas(admin, workspace.id)}
          abrirId={searchParams.s ?? null}
        />
      )
    }
    query = query.in('id', visibles)
  }

  const [{ data: ticketRows }, departamentos, personas] = await Promise.all([
    query as unknown as Promise<{ data: TicketRow[] | null }>,
    cargarDepartamentos(admin, workspace.id),
    cargarPersonas(admin, workspace.id),
  ])

  const solicitudes: Solicitud[] = (ticketRows ?? []).map((t) => ({
    id: t.id,
    numero: t.numero,
    title: t.title,
    body: t.body,
    kind: t.kind,
    priority: t.priority,
    status: t.status,
    space_id: t.space_id,
    space_name: t.depto?.name ?? null,
    space_color: t.depto?.color ?? null,
    requested_by: t.requested_by,
    solicitante: t.solicitante?.display_name ?? 'Alguien',
    assignee_id: t.assignee_id,
    responsable: t.responsable?.display_name ?? null,
    needed_by: t.needed_by,
    due_date: t.due_date,
    decision_note: t.decision_note,
    created_at: t.created_at,
    closed_at: t.closed_at,
    links: Array.isArray(t.links) ? (t.links as Solicitud['links']) : [],
    attachments: Array.isArray(t.attachments) ? (t.attachments as Solicitud['attachments']) : [],
  }))

  return (
    <SolicitudesClient
      workspaceId={workspace.id}
      workspaceSlug={params.workspaceSlug}
      currentUserId={user.id}
      soyMando={soyMando}
      solicitudesIniciales={solicitudes}
      departamentos={departamentos}
      personas={personas}
      abrirId={searchParams.s ?? null}
    />
  )
}

type Admin = ReturnType<typeof createAdminClient>

/** Departamentos vivos del workspace, para el selector de destino. */
async function cargarDepartamentos(admin: Admin, workspaceId: string): Promise<Departamento[]> {
  const { data } = (await admin
    .from('spaces')
    .select('id, name, color, icon')
    .eq('workspace_id', workspaceId)
    .eq('is_archived', false)
    .order('name', { ascending: true })
    .limit(100)) as { data: Departamento[] | null }
  return data ?? []
}

/** Gente del workspace, para asignar responsable e involucrar a alguien mas. */
async function cargarPersonas(admin: Admin, workspaceId: string): Promise<Persona[]> {
  type MemberRow = {
    profile_id: string
    perfil: { id: string; display_name: string; avatar_url: string | null } | null
  }
  const { data } = (await admin
    .from('workspace_members')
    .select('profile_id, perfil:profiles!workspace_members_profile_id_fkey ( id, display_name, avatar_url )')
    .eq('workspace_id', workspaceId)
    .limit(300)) as { data: MemberRow[] | null }

  return (data ?? [])
    .filter((m) => m.perfil)
    .map((m) => ({
      id: m.profile_id,
      nombre: m.perfil!.display_name,
      avatar_url: m.perfil!.avatar_url,
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
}

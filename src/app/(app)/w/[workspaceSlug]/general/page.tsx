/**
 * /w/[workspaceSlug]/general, Chat GENERAL del workspace (canal entre equipos).
 *
 * Server Component: valida que el visor sea miembro del workspace (o admin de la
 * org), carga el historial reciente de workspace_messages (admin client,
 * anti-RLS-loop) + los miembros del workspace para resolver autores, y delega al
 * cliente WorkspaceChat que hace realtime (append en vivo) + envío.
 *
 * A diferencia del chat por equipo, este canal es transversal: lo ve y escribe
 * cualquier miembro del workspace, sin importar a qué equipo pertenece.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { getCachedUser } from '@/lib/auth'
import { isOrgAdmin } from '@/lib/team-access'
import { WorkspaceChat } from '@/components/chat/WorkspaceChat'

interface GeneralPageProps {
  params: { workspaceSlug: string }
}

export const metadata = { title: 'General · WLO' }

export default async function GeneralChatPage({ params }: GeneralPageProps) {
  const user = await getCachedUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // ── Resolver workspace por slug + membresía del visor ─────────────────────
  const { data: wsRow } = (await admin
    .from('workspace_members')
    .select('role, workspaces!inner ( id, name, slug )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle()) as {
    data: { role: string; workspaces: { id: string; name: string; slug: string } | null } | null
    error: unknown
  }

  let workspace = wsRow?.workspaces ?? null

  // Admin de la org que no es miembro directo: resuelve el workspace por slug
  // igual (supervisión), mismo criterio que el resto de rutas.
  if (!workspace && (await isOrgAdmin(user.id))) {
    const { data: wsBySlug } = (await admin
      .from('workspaces')
      .select('id, name, slug')
      .eq('slug', params.workspaceSlug)
      .limit(1)
      .maybeSingle()) as { data: { id: string; name: string; slug: string } | null; error: unknown }
    workspace = wsBySlug
  }

  if (!workspace) notFound()

  // ── Miembros del workspace (para resolver autores en el cliente) ──────────
  type MemberRow = {
    profile: { id: string; display_name: string; avatar_url: string | null } | null
  }
  const { data: memberRows } = await admin
    .from('workspace_members')
    .select('profile:profiles ( id, display_name, avatar_url )')
    .eq('workspace_id', workspace.id) as { data: MemberRow[] | null; error: unknown }

  const members = (memberRows ?? [])
    .filter(m => m.profile != null)
    .map(m => m.profile!)

  // ── Historial reciente (últimos 100, ascendente) ──────────────────────────
  type MsgRow = {
    id: string
    author_id: string
    body: string
    created_at: string
    attachments:
      | { type: 'file'; path: string; name: string; mime: string; size: number }[]
      | null
  }
  const { data: msgRows } = await admin
    .from('workspace_messages')
    .select('id, author_id, body, created_at, attachments')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })
    .limit(100) as { data: MsgRow[] | null; error: unknown }

  const messages = (msgRows ?? []).slice().reverse()

  // ── Reacciones de los mensajes cargados (para pintar pills al entrar) ──────
  type ReactionRow = { id: string; message_id: string; profile_id: string; emoji: string }
  const messageIds = messages.map(m => m.id)
  let reactions: ReactionRow[] = []
  if (messageIds.length > 0) {
    const { data: rxRows } = await admin
      .from('workspace_message_reactions')
      .select('id, message_id, profile_id, emoji')
      .in('message_id', messageIds) as { data: ReactionRow[] | null; error: unknown }
    reactions = rxRows ?? []
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-4 pb-2 border-b border-border">
        <p className="text-xs text-muted-foreground mb-0.5">
          <Link href={`/w/${params.workspaceSlug}`} className="hover:text-foreground transition-colors">
            {workspace.name}
          </Link>
        </p>
        <h1 className="text-lg font-semibold text-foreground">General (todos los equipos)</h1>
      </div>
      <WorkspaceChat
        workspaceId={workspace.id}
        currentUserId={user.id}
        members={members}
        initialMessages={messages}
        initialReactions={reactions}
      />
    </div>
  )
}

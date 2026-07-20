/**
 * /w/[workspaceSlug]/t/[teamSlug]/chat, Chat del equipo.
 *
 * Server Component: valida acceso al equipo, carga el historial reciente de
 * mensajes (admin client, anti-RLS-loop) + los miembros para resolver autores,
 * y delega al cliente TeamChat que hace realtime (append en vivo) + envío.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { resolveTeamForViewer } from '@/lib/team-access'
import { TeamChat } from '@/components/chat/TeamChat'

interface ChatPageProps {
  params: { workspaceSlug: string; teamSlug: string }
}

export const metadata = { title: 'Chat · WLO' }

export default async function ChatPage({ params }: ChatPageProps) {
  const res = await resolveTeamForViewer(params.workspaceSlug, params.teamSlug)
  if (!res.ok && res.reason === 'no-auth') redirect('/auth/login')
  if (!res.ok) notFound()
  const { userId, workspace, team } = res.ctx

  const admin = createAdminClient()

  // ── Miembros del equipo (para resolver autores en el cliente) ─────────────
  type MemberRow = {
    profile: { id: string; display_name: string; avatar_url: string | null } | null
  }
  const { data: memberRows } = await admin
    .from('team_members')
    .select('profile:profiles ( id, display_name, avatar_url )')
    .eq('team_id', team.id) as { data: MemberRow[] | null; error: unknown }

  const members = (memberRows ?? [])
    .filter(m => m.profile != null)
    .map(m => m.profile!)

  // ── Historial reciente (últimos 100, ascendente) ──────────────────────────
  type MsgRow = { id: string; author_id: string; body: string; created_at: string }
  const { data: msgRows } = await admin
    .from('messages')
    .select('id, author_id, body, created_at')
    .eq('team_id', team.id)
    .order('created_at', { ascending: false })
    .limit(100) as { data: MsgRow[] | null; error: unknown }

  const messages = (msgRows ?? []).slice().reverse()

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-4 pb-2 border-b border-border">
        <p className="text-xs text-muted-foreground mb-0.5">
          <Link href={`/w/${params.workspaceSlug}`} className="hover:text-foreground transition-colors">
            {workspace.name}
          </Link>
          {' / '}
          <Link
            href={`/w/${params.workspaceSlug}/t/${params.teamSlug}`}
            className="hover:text-foreground transition-colors"
          >
            {team.name}
          </Link>
        </p>
        <h1 className="text-lg font-semibold text-foreground">Chat del equipo</h1>
      </div>
      <TeamChat
        teamId={team.id}
        currentUserId={userId}
        members={members}
        initialMessages={messages}
      />
    </div>
  )
}

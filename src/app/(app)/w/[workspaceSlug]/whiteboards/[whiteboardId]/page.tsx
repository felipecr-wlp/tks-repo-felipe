/**
 * /w/[slug]/whiteboards/[id] — editor de pizarra con Excalidraw.
 */
import { notFound, redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { WhiteboardEditor } from './WhiteboardEditor'

interface PageProps {
  params: { workspaceSlug: string; whiteboardId: string }
}

export const metadata = { title: 'Pizarra · WLO' }

type BoardFull = {
  id: string
  workspace_id: string
  title: string
  content: string | null
  visibility: string
  created_by: string | null
  updated_at: string
}

export default async function WhiteboardPage({ params }: PageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  type WsFromMember = { workspaces: { id: string; name: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null; error: unknown }

  const workspace = row?.workspaces
  if (!workspace) redirect('/')

  const { data: board } = await admin
    .from('whiteboards')
    .select('id, workspace_id, title, content, visibility, created_by, updated_at')
    .eq('id', params.whiteboardId)
    .eq('workspace_id', workspace.id)
    .maybeSingle() as { data: BoardFull | null; error: unknown }

  if (!board) notFound()
  if (board.visibility === 'private' && board.created_by !== user.id) notFound()

  // Nombre para la presencia ("quién está viendo") en la pizarra colaborativa.
  type ProfileRow = { display_name: string | null } | null
  const { data: profile } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle() as { data: ProfileRow; error: unknown }

  const currentUserName =
    profile?.display_name || user.email?.split('@')[0] || 'Miembro'

  return (
    <WhiteboardEditor
      initial={board}
      currentUserId={user.id}
      currentUserName={currentUserName}
      workspaceSlug={params.workspaceSlug}
    />
  )
}

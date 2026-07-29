/**
 * /w/[slug]/whiteboards/[id], editor de pizarra con Excalidraw.
 */
import { notFound, redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { WhiteboardEditor } from './WhiteboardEditor'
import { getServerT } from '@/lib/i18n/server'
import { loadNoteViewerContext } from '@/lib/note-visibility'
import { canViewWhiteboard } from '@/lib/whiteboard-visibility'
import { canPostWorkspaceMessage } from '@/lib/workspace-admin'

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
  space_id: string | null
  project_id: string | null
  note_id: string | null
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
    .select('id, workspace_id, title, content, visibility, space_id, project_id, note_id, created_by, updated_at')
    .eq('id', params.whiteboardId)
    .eq('workspace_id', workspace.id)
    .maybeSingle() as { data: BoardFull | null; error: unknown }

  if (!board) notFound()

  // Esta pagina lee con service-role, que bypassa el RLS de whiteboards. Sin
  // este check, cualquier miembro con el UUID abria la pizarra por URL.
  const viewerCtx = await loadNoteViewerContext(admin, workspace.id, user.id)
  if (!(await canViewWhiteboard(admin, viewerCtx, board))) notFound()

  // Nombre para la presencia ("quién está viendo") en la pizarra colaborativa.
  type ProfileRow = { display_name: string | null; org_role: string | null } | null
  const { data: profile } = await admin
    .from('profiles')
    .select('display_name, org_role')
    .eq('id', user.id)
    .maybeSingle() as { data: ProfileRow; error: unknown }

  const t = getServerT()
  const currentUserName =
    profile?.display_name || user.email?.split('@')[0] || t('act.user')

  // Quien puede ELIMINAR: creador, admin de workspace, u owner/admin de la org.
  // Refleja la regla del DELETE en /api/whiteboards/[id].
  const { data: wsMember } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace.id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  const canManage =
    board.created_by === user.id ||
    profile?.org_role === 'owner' || profile?.org_role === 'admin' ||
    wsMember?.role === 'admin'

  // Departamentos con los que este usuario puede compartir. Un admin de org ve
  // todos; el resto, solo los suyos: compartir con un departamento ajeno seria
  // filtrar hacia afuera.
  const isOrgAdmin = profile?.org_role === 'owner' || profile?.org_role === 'admin'
  const { data: allSpaces } = await admin
    .from('spaces')
    .select('id, name')
    .eq('workspace_id', workspace.id)
    .eq('is_archived', false)
    .order('name', { ascending: true }) as { data: { id: string; name: string }[] | null; error: unknown }

  const shareableSpaces = isOrgAdmin
    ? (allSpaces ?? [])
    : (allSpaces ?? []).filter(s => viewerCtx.spaceIds.has(s.id))

  const canPublishWorkspace = await canPostWorkspaceMessage(admin, workspace.id, user.id)

  return (
    <WhiteboardEditor
      initial={board}
      currentUserId={user.id}
      currentUserName={currentUserName}
      workspaceSlug={params.workspaceSlug}
      canManage={canManage}
      spaces={shareableSpaces}
      canPublishWorkspace={canPublishWorkspace}
    />
  )
}

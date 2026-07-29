/**
 * /w/[slug]/notes/[id], editor de una nota (Notion-lite).
 * Server Component que carga la nota y delega edición al cliente.
 */
import { notFound, redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { loadNoteViewerContext, canViewNote } from '@/lib/note-visibility'
import { canPostWorkspaceMessage } from '@/lib/workspace-admin'
import { getServerT } from '@/lib/i18n/server'
import { NoteEditor } from './NoteEditor'

interface NotePageProps {
  params: { workspaceSlug: string; noteId: string }
}

export const metadata = { title: 'Nota · WLO' }

type NoteFull = {
  id: string
  workspace_id: string
  parent_note_id: string | null
  space_id: string | null
  project_id: string | null
  icon: string | null
  title: string
  content: string | null
  visibility: string
  doc_kind: 'note' | 'sop' | 'sop_flow' | 'sop_index' | 'training'
  sop_status: 'draft' | 'review' | 'active' | 'obsolete' | null
  sop_version: string | null
  review_due: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  author: { display_name: string; avatar_url: string | null } | null
}

type Breadcrumb = { id: string; title: string; icon: string | null }
type ChildNote = { id: string; title: string; icon: string | null }

export default async function NotePage({ params }: NotePageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // Workspace desde membership
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

  // Cargar nota
  const { data: note } = await admin
    .from('notes')
    .select(`
      id, workspace_id, parent_note_id, space_id, project_id, icon,
      title, content, visibility,
      doc_kind, sop_status, sop_version, review_due,
      created_by, created_at, updated_at,
      author:profiles ( display_name, avatar_url )
    `)
    .eq('id', params.noteId)
    .eq('workspace_id', workspace.id)
    .maybeSingle() as { data: NoteFull | null; error: unknown }

  if (!note) notFound()

  // Modelo de visibilidad (privada = solo autor, space/team = su departamento,
  // project = su proyecto, workspace = la empresa) MAS el aislamiento de
  // departamentos restringidos. Esta pagina usa admin client, que bypassa el
  // RLS de notes; sin este check cualquier miembro del workspace con el UUID
  // podia abrir y editar la nota directo por URL.
  const noteCtx = await loadNoteViewerContext(admin, workspace.id, user.id)
  if (!canViewNote(noteCtx, note)) {
    notFound()
  }

  // Breadcrumb de ancestros: una sola consulta (CTE recursiva en la RPC
  // note_ancestors) en vez del bucle N+1 de hasta 10 lecturas secuenciales.
  // La RPC devuelve ya ordenado del root al padre inmediato, con tope de 10.
  type AncestorRow = { id: string; title: string; icon: string | null }
  const { data: ancestors } = await admin
    .rpc('note_ancestors', { p_note_id: note.id }) as { data: AncestorRow[] | null; error: unknown }
  const breadcrumbs: Breadcrumb[] = (ancestors ?? []).map(a => ({ id: a.id, title: a.title, icon: a.icon }))

  // Sub-páginas directas
  const { data: children } = await admin
    .from('notes')
    .select('id, title, icon')
    .eq('parent_note_id', note.id)
    .order('updated_at', { ascending: false }) as { data: ChildNote[] | null; error: unknown }

  // Identidad del usuario actual para presencia en vivo (A5).
  type SelfProfile = { display_name: string | null; avatar_url: string | null; org_role: string | null }
  const { data: self } = await admin
    .from('profiles')
    .select('display_name, avatar_url, org_role')
    .eq('id', user.id)
    .maybeSingle() as { data: SelfProfile | null; error: unknown }

  // Quien puede ELIMINAR: creador, admin de workspace, u owner/admin de la org.
  // Debe reflejar exactamente la regla del DELETE en /api/notes/[noteId].
  const { data: wsMember } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace.id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  const canManage =
    note.created_by === user.id ||
    self?.org_role === 'owner' || self?.org_role === 'admin' ||
    wsMember?.role === 'admin'

  // Departamentos con los que este usuario puede compartir la nota. Un admin de
  // org ve todos; el resto, solo aquellos a los que pertenece. Compartir con un
  // departamento ajeno no es una opcion: seria filtrar hacia afuera.
  const isOrgAdmin = self?.org_role === 'owner' || self?.org_role === 'admin'
  const { data: allSpaces } = await admin
    .from('spaces')
    .select('id, name')
    .eq('workspace_id', workspace.id)
    .eq('is_archived', false)
    .order('name', { ascending: true }) as { data: { id: string; name: string }[] | null; error: unknown }

  const shareableSpaces = isOrgAdmin
    ? (allSpaces ?? [])
    : (allSpaces ?? []).filter(s => noteCtx.spaceIds.has(s.id))

  // Abrir un documento a TODA la empresa es acto de mando (mismos roles que el
  // comunicado en General). La API valida lo mismo del lado servidor.
  const canPublishWorkspace = await canPostWorkspaceMessage(admin, workspace.id, user.id)

  const t = getServerT()

  return (
    <div className="h-full overflow-y-auto">
      <NoteEditor
        initial={note}
        currentUserId={user.id}
        currentUserName={self?.display_name ?? t('act.user')}
        currentUserAvatar={self?.avatar_url ?? null}
        workspaceSlug={params.workspaceSlug}
        workspaceId={workspace.id}
        canManage={canManage}
        breadcrumbs={breadcrumbs}
        childNotes={children ?? []}
        spaces={shareableSpaces}
        canPublishWorkspace={canPublishWorkspace}
      />
    </div>
  )
}

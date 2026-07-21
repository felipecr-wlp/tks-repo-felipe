/**
 * /w/[slug]/notes/[id], editor de una nota (Notion-lite).
 * Server Component que carga la nota y delega edición al cliente.
 */
import { notFound, redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { canAccessNoteSpace } from '@/lib/note-space-access'
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
      id, workspace_id, parent_note_id, space_id, icon,
      title, content, visibility,
      doc_kind, sop_status, sop_version, review_due,
      created_by, created_at, updated_at,
      author:profiles ( display_name, avatar_url )
    `)
    .eq('id', params.noteId)
    .eq('workspace_id', workspace.id)
    .maybeSingle() as { data: NoteFull | null; error: unknown }

  if (!note) notFound()

  if (note.visibility === 'private' && note.created_by !== user.id) {
    notFound()
  }

  // F3: nota de un espacio restringido (RH, Legal, Finanzas), solo admin de
  // org o miembro del espacio. Esta pagina usa admin client, que bypassa el
  // RLS notes_restrict_space; sin este check cualquier miembro del workspace
  // con el UUID podia abrir y editar la nota directo por URL.
  if (!(await canAccessNoteSpace(admin, note.space_id, user.id))) {
    notFound()
  }

  // Breadcrumb de ancestros (subir hasta encontrar root)
  const breadcrumbs: Breadcrumb[] = []
  let currentParentId = note.parent_note_id
  // Limitar profundidad por seguridad
  for (let i = 0; i < 10 && currentParentId; i++) {
    type AncestorRow = { id: string; title: string; icon: string | null; parent_note_id: string | null }
    const { data: ancestor } = await admin
      .from('notes')
      .select('id, title, icon, parent_note_id')
      .eq('id', currentParentId)
      .maybeSingle() as { data: AncestorRow | null; error: unknown }
    if (!ancestor) break
    breadcrumbs.unshift({ id: ancestor.id, title: ancestor.title, icon: ancestor.icon })
    currentParentId = ancestor.parent_note_id
  }

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

  return (
    <div className="h-full overflow-y-auto">
      <NoteEditor
        initial={note}
        currentUserId={user.id}
        currentUserName={self?.display_name ?? 'Usuario'}
        currentUserAvatar={self?.avatar_url ?? null}
        workspaceSlug={params.workspaceSlug}
        workspaceId={workspace.id}
        canManage={canManage}
        breadcrumbs={breadcrumbs}
        childNotes={children ?? []}
      />
    </div>
  )
}

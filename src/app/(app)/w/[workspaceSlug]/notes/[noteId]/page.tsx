/**
 * /w/[slug]/notes/[id] — editor de una nota (Notion-lite).
 * Server Component que carga la nota y delega edición al cliente.
 */
import { notFound, redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NoteEditor } from './NoteEditor'

interface NotePageProps {
  params: { workspaceSlug: string; noteId: string }
}

export const metadata = { title: 'Nota · WLO' }

type NoteFull = {
  id: string
  workspace_id: string
  parent_note_id: string | null
  icon: string | null
  title: string
  content: string | null
  visibility: string
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
      id, workspace_id, parent_note_id, icon,
      title, content, visibility,
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

  return (
    <div className="h-full overflow-y-auto">
      <NoteEditor
        initial={note}
        currentUserId={user.id}
        workspaceSlug={params.workspaceSlug}
        workspaceId={workspace.id}
        breadcrumbs={breadcrumbs}
        childNotes={children ?? []}
      />
    </div>
  )
}

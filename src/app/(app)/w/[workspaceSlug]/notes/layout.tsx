/**
 * Layout de notas — split view persistente.
 * Sidebar con árbol del wiki a la izquierda, editor / contenido a la derecha.
 */
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { NotesTreeSidebar } from '@/components/notes/NotesTreeSidebar'

interface NotesLayoutProps {
  children: React.ReactNode
  params: { workspaceSlug: string }
}

interface NoteTreeRow {
  id: string
  title: string
  icon: string | null
  parent_note_id: string | null
  visibility: string
  updated_at: string
  created_by: string | null
}

export default async function NotesLayout({ children, params }: NotesLayoutProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // Workspace desde membership (anti-RLS)
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

  // Cargar todas las notas del workspace (visibilidad básica filtrada)
  const { data: rawNotes } = await admin
    .from('notes')
    .select('id, title, icon, parent_note_id, visibility, updated_at, created_by')
    .eq('workspace_id', workspace.id)
    .order('updated_at', { ascending: false })
    .limit(500) as { data: NoteTreeRow[] | null; error: unknown }

  const notes = (rawNotes ?? []).filter(n =>
    n.visibility !== 'private' || n.created_by === user.id
  )

  return (
    <div className="flex h-full overflow-hidden">
      <NotesTreeSidebar
        notes={notes}
        workspaceId={workspace.id}
        workspaceSlug={params.workspaceSlug}
        currentUserId={user.id}
      />
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  )
}

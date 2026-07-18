/**
 * Layout de notas, split view persistente.
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
  space_id: string | null
  visibility: string
  updated_at: string
  created_by: string | null
}

interface SpaceRow {
  id: string
  name: string
  icon: string | null
  color: string | null
  is_restricted: boolean
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
    .select('id, title, icon, parent_note_id, space_id, visibility, updated_at, created_by')
    .eq('workspace_id', workspace.id)
    .order('updated_at', { ascending: false })
    .limit(500) as { data: NoteTreeRow[] | null; error: unknown }

  const notes = (rawNotes ?? []).filter(n =>
    n.visibility !== 'private' || n.created_by === user.id
  )

  // Cargar departamentos (espacios) del workspace. La visibilidad fina de
  // restringidos se afinara en F3; aqui se filtra best-effort por membresia.
  const { data: rawSpaces } = await admin
    .from('spaces')
    .select('id, name, icon, color, is_restricted, created_by')
    .eq('workspace_id', workspace.id)
    .eq('is_archived', false)
    .order('name', { ascending: true }) as { data: SpaceRow[] | null; error: unknown }

  const { data: mySpaceMemberships } = await admin
    .from('space_members')
    .select('space_id')
    .eq('profile_id', user.id) as { data: { space_id: string }[] | null; error: unknown }
  const mySpaceIds = new Set((mySpaceMemberships ?? []).map(m => m.space_id))

  const spaces = (rawSpaces ?? []).filter(s =>
    !s.is_restricted || s.created_by === user.id || mySpaceIds.has(s.id)
  )

  return (
    <div className="flex h-full overflow-hidden">
      <NotesTreeSidebar
        notes={notes}
        spaces={spaces}
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

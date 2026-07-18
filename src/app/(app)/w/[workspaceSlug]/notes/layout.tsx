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

  // Rol de organizacion: owner/admin ven todo (espacios y notas restringidos).
  const { data: myProfile } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', user.id)
    .maybeSingle() as { data: { org_role: string | null } | null; error: unknown }
  const isOrgAdmin = myProfile?.org_role === 'owner' || myProfile?.org_role === 'admin'

  // Cargar departamentos (espacios) del workspace. Ocultamiento estricto de
  // restringidos (F3): reflejo en app-layer del RLS (el arbol lee con admin
  // client, que bypassa RLS, asi que este filtro ES la puerta real de la UI).
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

  // Un espacio restringido es accesible solo si eres admin de org o miembro.
  // (Sin escape por created_by: coincide con el RLS estricto de F3; el creador
  // ya queda como space_member owner al crearlo, asi que no se pierde acceso.)
  const canAccessSpace = (spaceId: string, restricted: boolean) =>
    !restricted || isOrgAdmin || mySpaceIds.has(spaceId)

  const spaces = (rawSpaces ?? []).filter(s => canAccessSpace(s.id, s.is_restricted))

  // Ids de espacios restringidos a los que el usuario NO puede entrar: sus notas
  // se ocultan del arbol aunque su visibility sea 'workspace'.
  const blockedSpaceIds = new Set(
    (rawSpaces ?? [])
      .filter(s => s.is_restricted && !canAccessSpace(s.id, true))
      .map(s => s.id)
  )

  const notes = (rawNotes ?? []).filter(n => {
    if (n.visibility === 'private' && n.created_by !== user.id) return false
    if (n.space_id && blockedSpaceIds.has(n.space_id)) return false
    return true
  })

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

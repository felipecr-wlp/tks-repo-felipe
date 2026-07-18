/**
 * Layout del workspace, incluye Sidebar con equipos y proyectos.
 * Carga data del workspace en el servidor para evitar flicker.
 */
import { redirect, notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { FloatingChat } from '@/components/chat/FloatingChat'
import { GlobalNewTaskModal } from '@/components/tasks/GlobalNewTaskModal'

interface WorkspaceLayoutProps {
  children: React.ReactNode
  params: { workspaceSlug: string }
}

// Tipos para las queries (hasta regenerar tipos de Supabase)
type WorkspaceData = {
  id: string
  name: string
  slug: string
  org_id: string
  organizations: { id: string; name: string } | null
}

type TeamWithProjects = {
  id: string
  name: string
  slug: string
  projects: Array<{
    id: string
    name: string
    slug: string
    icon: string | null
  }>
}

type WorkspaceForSwitcher = {
  id: string
  name: string
  slug: string
}

type UserProfile = {
  id: string
  display_name: string
  avatar_url: string | null
  org_id: string | null
}

export default async function WorkspaceLayout({
  children,
  params,
}: WorkspaceLayoutProps) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // ── Lookup atómico: workspace DESDE la membership del user ────────────────
  // Esto evita ambigüedad cuando hay múltiples workspaces con el mismo slug
  // (slug es único por org, no globalmente). También elimina el riesgo de
  // loop entre /w/<slug> y / cuando los datos del profile están inconsistentes.
  type MembershipWithWs = {
    role: string
    workspaces: {
      id: string
      name: string
      slug: string
      org_id: string
      organizations: { id: string; name: string } | null
    } | null
  }

  const { data: row } = await admin
    .from('workspace_members')
    .select(`
      role,
      workspaces!inner (
        id, name, slug, org_id,
        organizations ( id, name )
      )
    `)
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: MembershipWithWs | null; error: unknown }

  if (!row || !row.workspaces) {
    // El usuario no es miembro de ningún workspace con ese slug → 404 real
    notFound()
  }

  const workspace: WorkspaceData = row.workspaces

  // ── Cargar perfil del usuario ──────────────────────────────────────────────
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, org_id')
    .eq('id', user.id)
    .single() as { data: UserProfile | null; error: unknown }

  // ── Cargar equipos del workspace (con proyectos) ───────────────────────────
  // Egress optimizado: solo columnas necesarias para el sidebar
  type RawTeam = {
    id: string
    name: string
    slug: string
    team_members: Array<{ profile_id: string }>
    projects: Array<{
      id: string
      name: string
      slug: string
      icon: string | null
      project_members: Array<{ profile_id: string }>
    }>
  }

  const { data: rawTeams } = await supabase
    .from('teams')
    .select(`
      id,
      name,
      slug,
      team_members!inner ( profile_id ),
      projects (
        id,
        name,
        slug,
        icon,
        project_members!inner ( profile_id )
      )
    `)
    .eq('workspace_id', workspace.id)
    .eq('team_members.profile_id', user.id)
    .eq('projects.project_members.profile_id', user.id)
    .order('name', { ascending: true }) as { data: RawTeam[] | null; error: unknown }

  // Limpiar data para el sidebar (sin datos de membresía)
  const teams: TeamWithProjects[] = (rawTeams ?? []).map(t => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    projects: (t.projects ?? []).map(p => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      icon: p.icon,
    })),
  }))

  // ── Cargar todos los workspaces del usuario (para el switcher) ─────────────
  type WsMemberRow = {
    workspaces: { id: string; name: string; slug: string } | null
  }

  const { data: wsMemberships } = await supabase
    .from('workspace_members')
    .select('workspaces ( id, name, slug )')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: true }) as { data: WsMemberRow[] | null; error: unknown }

  const allWorkspaces: WorkspaceForSwitcher[] = (wsMemberships ?? [])
    .filter(m => m.workspaces != null)
    .map(m => m.workspaces!)

  return (
    // flex-1 + min-w-0 + w-full: el layout raíz de (app) es un contenedor flex
    // (fila). Sin flex-1 este div NO se estira a llenar el viewport, sino que
    // toma el ancho de su contenido. En páginas normales el contenido es ancho
    // y no se nota, pero la pizarra usa Excalidraw en `absolute` (contribuye 0
    // al ancho intrínseco), así que la fila colapsaba al min-content de la barra
    // superior (~135px) y el canvas salía diminuto. flex-1 lo fuerza a viewport.
    <div className="flex h-screen overflow-hidden flex-1 min-w-0 w-full">
      {/* Command palette global (Cmd+K) */}
      <CommandPalette workspaceSlug={workspace.slug} workspaceId={workspace.id} />

      {/* Modal global "Nueva tarea" (atajo C) */}
      <GlobalNewTaskModal teams={teams} />

      {/* Sidebar */}
      <Sidebar
        workspaceSlug={workspace.slug}
        workspaceName={workspace.name}
        orgName={workspace.organizations?.name ?? 'Mi organización'}
        teams={teams}
        userProfile={{
          id: user.id,
          display_name: profile?.display_name ?? user.email?.split('@')[0] ?? 'Usuario',
          avatar_url: profile?.avatar_url ?? null,
          email: user.email ?? '',
        }}
        allWorkspaces={allWorkspaces}
      />

      {/* Contenido principal */}
      <main className="flex-1 overflow-auto min-w-0">
        {children}
      </main>

      {/* Burbuja de chat flotante global (equipos del usuario) */}
      <FloatingChat
        workspaceSlug={workspace.slug}
        currentUserId={user.id}
        teams={teams.map(t => ({ id: t.id, name: t.name, slug: t.slug }))}
      />
    </div>
  )
}

/**
 * Layout del workspace, incluye Sidebar con equipos y proyectos.
 * Carga data del workspace en el servidor para evitar flicker.
 */
import { redirect, notFound } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { canAccessPath, normalizeHidden } from '@/lib/features'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { MobileTopBar } from '@/components/sidebar/MobileTopBar'
import { CommandPalette } from '@/components/command-palette/CommandPalette'
import { FloatingChat } from '@/components/chat/FloatingChat'
import { GlobalNewTaskModal } from '@/components/tasks/GlobalNewTaskModal'
import { KeyboardShortcutsHelp } from '@/components/KeyboardShortcutsHelp'
import { brandFromEmail } from '@/lib/brand'

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
  is_archived: boolean
  department: { id: string; name: string; is_restricted: boolean } | null
  projects: Array<{
    id: string
    name: string
    slug: string
    icon: string | null
  }>
}

type UserProfile = {
  id: string
  display_name: string
  avatar_url: string | null
  org_id: string | null
  org_role: string | null
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
    hidden_features: string[] | null
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
      hidden_features,
      workspaces!inner (
        id, name, slug, org_id,
        organizations!workspaces_org_id_fkey ( id, name )
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
    .select('id, display_name, avatar_url, org_id, org_role')
    .eq('id', user.id)
    .single() as { data: UserProfile | null; error: unknown }

  // ── Admin del workspace: org owner/admin O rol owner/admin en la membership ──
  // Los admins "ven equipos" completos (supervisión) aunque no sean miembros de
  // cada equipo/proyecto. El resto ve solo aquello donde participa.
  const isWorkspaceAdmin =
    profile?.org_role === 'owner' ||
    profile?.org_role === 'admin' ||
    row.role === 'owner' ||
    row.role === 'admin'

  // ── Funciones apagadas para esta persona ───────────────────────────────────
  // Guarda REAL, no cosmética: si la pantalla está apagada, la URL tampoco
  // abre. `x-pathname` lo pone el middleware, porque un layout no conoce su
  // propia ruta. Si el header faltara (arranque raro), no se bloquea nada: es
  // preferible mostrar de más que dejar a alguien fuera de su trabajo.
  const hiddenFeatures = normalizeHidden(row.hidden_features)
  const currentPath = headers().get('x-pathname')
  const wsBase = `/w/${workspace.slug}`
  if (currentPath && !canAccessPath(currentPath, wsBase, hiddenFeatures)) {
    redirect(wsBase)
  }

  // ── Cargar equipos del workspace (con proyectos) ───────────────────────────
  // Egress optimizado: solo columnas necesarias para el sidebar
  type RawTeam = {
    id: string
    name: string
    slug: string
    is_archived: boolean
    space_id: string | null
    team_members: Array<{ profile_id: string }>
    projects: Array<{
      id: string
      name: string
      slug: string
      icon: string | null
      project_members: Array<{ profile_id: string }>
    }>
  }

  // Admin: TODOS los equipos y proyectos del workspace (admin client, sin filtro
  // de membresía). Incluye equipos archivados para poder reactivarlos (se
  // muestran atenuados en el sidebar). No-admin: solo equipos/proyectos donde el
  // user participa (inner joins con su profile_id) y NUNCA los archivados.
  const { data: rawTeams } = isWorkspaceAdmin
    ? (await admin
        .from('teams')
        .select(`
          id,
          name,
          slug,
          is_archived,
          space_id,
          projects (
            id,
            name,
            slug,
            icon
          )
        `)
        .eq('workspace_id', workspace.id)
        .order('name', { ascending: true })) as { data: RawTeam[] | null; error: unknown }
    : (await supabase
        .from('teams')
        .select(`
          id,
          name,
          slug,
          is_archived,
          space_id,
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
        .eq('is_archived', false)
        .eq('team_members.profile_id', user.id)
        .eq('projects.project_members.profile_id', user.id)
        .order('name', { ascending: true })) as { data: RawTeam[] | null; error: unknown }

  // Etiquetas de departamento para agrupar en el sidebar. Se leen aparte (no via
  // embed PostgREST) para evitar los quirks de la FK compuesta teams->spaces.
  type DeptRow = { id: string; name: string; is_restricted: boolean }
  const { data: deptRows } = await admin
    .from('spaces')
    .select('id, name, is_restricted')
    .eq('workspace_id', workspace.id)
    .eq('is_archived', false) as { data: DeptRow[] | null; error: unknown }
  const deptById = new Map<string, DeptRow>((deptRows ?? []).map((d) => [d.id, d]))

  // Limpiar data para el sidebar (sin datos de membresía)
  const teams: TeamWithProjects[] = (rawTeams ?? []).map(t => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    is_archived: t.is_archived ?? false,
    department: t.space_id ? (deptById.get(t.space_id) ?? null) : null,
    projects: (t.projects ?? []).map(p => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      icon: p.icon,
    })),
  }))

  // Complementos instalados en este workspace (excluyendo widgets del dashboard)
  // Filtrados por preferencia del usuario (user_plugin_settings)
  type PluginRow = { id: string; app_id: string; manifest: Record<string, any>; enabled: boolean }
  const { data: rawPlugins } = await admin
    .from('connector_installs')
    .select('id, app_id, manifest, enabled')
    .eq('workspace_id', workspace.id)
    .eq('plugin_type', 'widget') as { data: PluginRow[] | null; error: unknown }

  // User-specific plugin prefs
  const { data: userPrefs } = await admin
    .from('user_plugin_settings')
    .select('install_id, enabled')
    .eq('user_id', user.id) as { data: Array<{ install_id: string; enabled: boolean }> | null; error: unknown }
  const prefsMap = new Map((userPrefs ?? []).map(p => [p.install_id, p.enabled]))

  // Obtener IDs de widgets para excluirlos de complementos
  const { data: widgetIds } = await admin
    .from('widget_catalog')
    .select('id') as { data: { id: string }[] | null; error: unknown }
  const widgetIdSet = new Set((widgetIds ?? []).map(w => w.id))
  const plugins = (rawPlugins ?? [])
    .filter(p => !widgetIdSet.has(p.app_id))
    .filter(p => prefsMap.has(p.id) ? prefsMap.get(p.id) : p.enabled) // user pref or default

  // Ya no se cargan "todos los workspaces del usuario": WLO opera con un solo
  // espacio y el encabezado dejo de ser un selector. Una consulta menos por
  // cada pantalla del app.

  return (
    // flex-1 + min-w-0 + w-full: el layout raíz de (app) es un contenedor flex
    // (fila). Sin flex-1 este div NO se estira a llenar el viewport, sino que
    // toma el ancho de su contenido. En páginas normales el contenido es ancho
    // y no se nota, pero la pizarra usa Excalidraw en `absolute` (contribuye 0
    // al ancho intrínseco), así que la fila colapsaba al min-content de la barra
    // superior (~135px) y el canvas salía diminuto. flex-1 lo fuerza a viewport.
    <div className="flex h-screen overflow-hidden flex-1 min-w-0 w-full">
      {/* Command palette global (Cmd+K) */}
      <CommandPalette
        workspaceSlug={workspace.slug}
        workspaceId={workspace.id}
        isAdmin={isWorkspaceAdmin}
        hiddenFeatures={hiddenFeatures}
      />

      {/* Modal global "Nueva tarea" (atajo C) */}
      <GlobalNewTaskModal teams={teams} />

      {/* Overlay de ayuda de atajos de teclado (atajo ?) */}
      <KeyboardShortcutsHelp />

      {/* Sidebar */}
      <Sidebar
        workspaceSlug={workspace.slug}
        workspaceName={workspace.name}
        orgName={brandFromEmail(user.email) ?? workspace.organizations?.name ?? 'Mi organización'}
        teams={teams}
        isAdmin={isWorkspaceAdmin}
        userProfile={{
          id: user.id,
          display_name: profile?.display_name ?? user.email?.split('@')[0] ?? 'Usuario',
          avatar_url: profile?.avatar_url ?? null,
          email: user.email ?? '',
        }}
        hiddenFeatures={hiddenFeatures}
        plugins={plugins ?? []}
      />

      {/* Columna de contenido: barra superior movil + main.
          En movil el Sidebar es `fixed` (fuera del flujo), asi que esta columna
          ocupa todo el ancho; la hamburguesa vive en la barra superior. */}
      <div className="flex flex-col flex-1 min-w-0">
        <MobileTopBar workspaceName={workspace.name} />
        <main className="flex-1 overflow-auto min-w-0">
          {children}
        </main>
      </div>

      {/* Burbuja de chat flotante global (equipos del usuario) */}
      <FloatingChat
        workspaceSlug={workspace.slug}
        currentUserId={user.id}
        teams={teams.map(t => ({ id: t.id, name: t.name, slug: t.slug }))}
      />
    </div>
  )
}

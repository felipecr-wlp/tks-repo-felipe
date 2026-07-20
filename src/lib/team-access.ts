/**
 * Resolución de acceso a rutas de equipo/proyecto para el VISOR.
 *
 * Regla: un usuario puede VER un equipo o proyecto de su workspace si es
 * miembro de ese equipo/proyecto O si es admin del workspace (org owner/admin
 * o workspace_members.role owner/admin). Esto empareja el sidebar, que a los
 * admins les muestra TODOS los equipos y proyectos del workspace: sin esto, un
 * admin que abre un equipo al que no pertenece recibe un 404 (notFound).
 *
 * Se usa el admin client (bypassa RLS) con checks explícitos de membresía,
 * igual que el layout del workspace y las rutas /api.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'

export interface TeamViewerContext {
  userId: string
  workspace: { id: string; name: string; slug: string }
  team: {
    id: string
    name: string
    slug: string
    description: string | null
    workspace_id: string
    methodology: string | null
  }
  role: string | null // rol en el equipo si es miembro, si no null
  isAdmin: boolean // admin del workspace/org
  isMember: boolean
}

export interface ProjectViewerContext {
  userId: string
  workspace: { id: string; name: string; slug: string }
  role: string | null // rol en el proyecto si es miembro, si no null
  isAdmin: boolean
  isMember: boolean
  project: {
    id: string
    name: string
    slug: string
    icon: string | null
    description: string | null
    workspace_id: string
    team_id: string
    team: { id: string; name: string; slug: string } | null
    workspace: { id: string; name: string } | null
  }
}

export type ViewerResult<T> =
  | { ok: true; ctx: T }
  | { ok: false; reason: 'no-auth' | 'not-found' }

async function resolveWorkspaceMembership(userId: string, workspaceSlug: string) {
  const admin = createAdminClient()
  const { data: wsRow } = (await admin
    .from('workspace_members')
    .select('role, workspaces!inner ( id, name, slug )')
    .eq('profile_id', userId)
    .eq('workspaces.slug', workspaceSlug)
    .limit(1)
    .maybeSingle()) as {
    data: { role: string; workspaces: { id: string; name: string; slug: string } | null } | null
    error: unknown
  }
  return wsRow
}

async function isOrgAdmin(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data: profile } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle()) as { data: { org_role: string | null } | null; error: unknown }
  const orgRole = profile?.org_role ?? 'member'
  return orgRole === 'owner' || orgRole === 'admin'
}

/**
 * Resuelve un equipo por slug para el visor (miembro O admin del workspace).
 */
export async function resolveTeamForViewer(
  workspaceSlug: string,
  teamSlug: string
): Promise<ViewerResult<TeamViewerContext>> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'no-auth' }

  const admin = createAdminClient()

  const wsRow = await resolveWorkspaceMembership(user.id, workspaceSlug)
  if (!wsRow || !wsRow.workspaces) return { ok: false, reason: 'not-found' }
  const workspace = wsRow.workspaces

  const { data: team } = (await admin
    .from('teams')
    .select('id, name, slug, description, workspace_id, methodology')
    .eq('slug', teamSlug)
    .eq('workspace_id', workspace.id)
    .limit(1)
    .maybeSingle()) as { data: TeamViewerContext['team'] | null; error: unknown }
  if (!team) return { ok: false, reason: 'not-found' }

  const { data: tm } = (await admin
    .from('team_members')
    .select('role')
    .eq('team_id', team.id)
    .eq('profile_id', user.id)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }

  const isAdmin =
    wsRow.role === 'owner' || wsRow.role === 'admin' || (await isOrgAdmin(user.id))
  const isMember = tm != null

  if (!isMember && !isAdmin) return { ok: false, reason: 'not-found' }

  return {
    ok: true,
    ctx: { userId: user.id, workspace, team, role: tm?.role ?? null, isAdmin, isMember },
  }
}

/**
 * Resuelve un proyecto por slug para el visor (miembro del proyecto O admin del
 * workspace). Verifica coherencia con el team de la URL.
 */
export async function resolveProjectForViewer(
  workspaceSlug: string,
  teamSlug: string,
  projectSlug: string
): Promise<ViewerResult<ProjectViewerContext>> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'no-auth' }

  const admin = createAdminClient()

  const wsRow = await resolveWorkspaceMembership(user.id, workspaceSlug)
  if (!wsRow || !wsRow.workspaces) return { ok: false, reason: 'not-found' }
  const workspace = wsRow.workspaces

  const { data: project } = (await admin
    .from('projects')
    .select(`
      id, name, slug, icon, description, workspace_id, team_id,
      team:teams ( id, name, slug ),
      workspace:workspaces ( id, name )
    `)
    .eq('slug', projectSlug)
    .eq('workspace_id', workspace.id)
    .limit(1)
    .maybeSingle()) as { data: ProjectViewerContext['project'] | null; error: unknown }

  if (!project) return { ok: false, reason: 'not-found' }
  if (project.team?.slug !== teamSlug) return { ok: false, reason: 'not-found' }

  const { data: pm } = (await admin
    .from('project_members')
    .select('role')
    .eq('project_id', project.id)
    .eq('profile_id', user.id)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }

  const isAdmin =
    wsRow.role === 'owner' || wsRow.role === 'admin' || (await isOrgAdmin(user.id))
  const isMember = pm != null

  if (!isMember && !isAdmin) return { ok: false, reason: 'not-found' }

  return {
    ok: true,
    ctx: { userId: user.id, workspace, project, role: pm?.role ?? null, isAdmin, isMember },
  }
}

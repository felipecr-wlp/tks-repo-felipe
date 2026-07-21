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
    is_archived: boolean
    space_id: string | null
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

/**
 * Acceso al chat/tareas de un equipo por id (sin resolver slugs).
 *
 * Es miembro directo (team_members) O admin del workspace dueño del equipo
 * (org_role owner/admin, o workspace_members.role owner/admin). Replica la regla
 * del sidebar, que a los admins les muestra TODOS los equipos del workspace.
 * Compartido por /api/messages y los endpoints de adjuntos del chat.
 */
export async function canAccessTeamById(
  admin: ReturnType<typeof createAdminClient>,
  teamId: string,
  userId: string
): Promise<boolean> {
  const { data: membership } = (await admin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }
  if (membership) return true

  const { data: team } = (await admin
    .from('teams')
    .select('workspace_id')
    .eq('id', teamId)
    .maybeSingle()) as { data: { workspace_id: string } | null; error: unknown }
  if (!team?.workspace_id) return false

  const { data: profile } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle()) as { data: { org_role: string | null } | null; error: unknown }
  const orgRole = profile?.org_role ?? 'member'
  if (orgRole === 'owner' || orgRole === 'admin') return true

  const { data: wsMember } = (await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', team.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }
  return wsMember?.role === 'owner' || wsMember?.role === 'admin'
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
    .select('id, name, slug, description, workspace_id, methodology, is_archived, space_id')
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

  // Aislamiento a nivel URL (defensa en profundidad, igual que la RLS
  // can_see_team). Los administradores del workspace/org lo saltan (supervisión).
  if (!isAdmin) {
    // Equipo desactivado (archivado): invisible para miembros regulares.
    if (team.is_archived) return { ok: false, reason: 'not-found' }

    // Departamento restringido: exige membresía del departamento.
    if (team.space_id) {
      const { data: dept } = (await admin
        .from('spaces')
        .select('is_restricted')
        .eq('id', team.space_id)
        .maybeSingle()) as { data: { is_restricted: boolean } | null; error: unknown }
      if (dept?.is_restricted) {
        const { data: sm } = (await admin
          .from('space_members')
          .select('profile_id')
          .eq('space_id', team.space_id)
          .eq('profile_id', user.id)
          .maybeSingle()) as { data: { profile_id: string } | null; error: unknown }
        if (!sm) return { ok: false, reason: 'not-found' }
      }
    }
  }

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

  // Mismo aislamiento por departamento/archivo que el equipo contenedor.
  if (!isAdmin) {
    const { data: parentTeam } = (await admin
      .from('teams')
      .select('is_archived, space_id')
      .eq('id', project.team_id)
      .maybeSingle()) as { data: { is_archived: boolean; space_id: string | null } | null; error: unknown }
    if (parentTeam?.is_archived) return { ok: false, reason: 'not-found' }
    if (parentTeam?.space_id) {
      const { data: dept } = (await admin
        .from('spaces')
        .select('is_restricted')
        .eq('id', parentTeam.space_id)
        .maybeSingle()) as { data: { is_restricted: boolean } | null; error: unknown }
      if (dept?.is_restricted) {
        const { data: sm } = (await admin
          .from('space_members')
          .select('profile_id')
          .eq('space_id', parentTeam.space_id)
          .eq('profile_id', user.id)
          .maybeSingle()) as { data: { profile_id: string } | null; error: unknown }
        if (!sm) return { ok: false, reason: 'not-found' }
      }
    }
  }

  return {
    ok: true,
    ctx: { userId: user.id, workspace, project, role: pm?.role ?? null, isAdmin, isMember },
  }
}

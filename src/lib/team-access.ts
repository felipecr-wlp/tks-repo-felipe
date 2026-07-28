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
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/auth'

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
    wip_limits: Record<string, number | null> | null
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
  const { data: membership, error: membershipErr } = (await admin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }
  // No tragarse el error: un fallo transitorio de la BD devuelve data=null y se
  // trataria como "no es miembro" (deny) sin dejar rastro. Se loguea para poder
  // diagnosticar denegaciones espurias; el comportamiento sigue siendo fail-closed.
  if (membershipErr) console.error('[canAccessTeamById] team_members read error:', membershipErr)
  if (membership) return true

  const { data: team, error: teamErr } = (await admin
    .from('teams')
    .select('workspace_id')
    .eq('id', teamId)
    .maybeSingle()) as { data: { workspace_id: string } | null; error: unknown }
  if (teamErr) console.error('[canAccessTeamById] teams read error:', teamErr)
  if (!team?.workspace_id) return false

  const { data: profile, error: profileErr } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle()) as { data: { org_role: string | null } | null; error: unknown }
  if (profileErr) console.error('[canAccessTeamById] profiles read error:', profileErr)
  const orgRole = profile?.org_role ?? 'member'
  if (orgRole === 'owner' || orgRole === 'admin') return true

  const { data: wsMember, error: wsErr } = (await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', team.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }
  if (wsErr) console.error('[canAccessTeamById] workspace_members read error:', wsErr)
  return wsMember?.role === 'owner' || wsMember?.role === 'admin'
}

/**
 * ¿Puede el usuario ver/escribir en el canal GENERAL del workspace (chat entre
 * equipos)? Basta con ser miembro del workspace (workspace_members) o admin de
 * la organización. A diferencia del chat de equipo, aquí NO se exige pertenecer
 * a un equipo concreto: el canal General es transversal a todos los equipos.
 * Fail-closed: cualquier error de lectura se loguea y se deniega.
 */
export async function canAccessWorkspaceById(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string
): Promise<boolean> {
  const { data: wsMember, error: wsErr } = (await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }
  if (wsErr) console.error('[canAccessWorkspaceById] workspace_members read error:', wsErr)
  if (wsMember) return true

  // Owner/admin de la organización puede supervisar cualquier workspace.
  const { data: profile, error: profileErr } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle()) as { data: { org_role: string | null } | null; error: unknown }
  if (profileErr) console.error('[canAccessWorkspaceById] profiles read error:', profileErr)
  const orgRole = profile?.org_role ?? 'member'
  return orgRole === 'owner' || orgRole === 'admin'
}

/**
 * ¿Puede el usuario ADMINISTRAR la configuración de un proyecto (p. ej. crear
 * automatizaciones)? Manager/lead/admin/owner del proyecto, o admin del
 * workspace/org. Devuelve también el workspace_id del proyecto (o null si no
 * existe) para reusar en la ruta sin otra consulta.
 */
export async function canManageProject(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  userId: string
): Promise<{ ok: boolean; workspaceId: string | null }> {
  const { data: project } = (await admin
    .from('projects')
    .select('workspace_id')
    .eq('id', projectId)
    .maybeSingle()) as { data: { workspace_id: string } | null; error: unknown }
  if (!project?.workspace_id) return { ok: false, workspaceId: null }

  const { data: pm } = (await admin
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }
  const pmRole = pm?.role ?? null
  if (pmRole && ['owner', 'admin', 'lead', 'manager'].includes(pmRole)) {
    return { ok: true, workspaceId: project.workspace_id }
  }

  const { data: profile } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle()) as { data: { org_role: string | null } | null; error: unknown }
  const orgRole = profile?.org_role ?? 'member'
  if (orgRole === 'owner' || orgRole === 'admin') {
    return { ok: true, workspaceId: project.workspace_id }
  }

  const { data: wsMember } = (await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', project.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }
  const ok = wsMember?.role === 'owner' || wsMember?.role === 'admin'
  return { ok, workspaceId: project.workspace_id }
}

/**
 * ¿Puede el usuario VER/EDITAR una tarea de un proyecto? Regla de LECTURA/edicion
 * ligera (mas amplia que canManageProject): cualquier miembro del proyecto
 * (cualquier rol), o un owner/admin del workspace/org (supervision). Se usa en
 * los endpoints de tarea para que los administradores del workspace puedan abrir
 * y reprogramar tareas de proyectos donde no estan inscritos como miembros.
 * Devuelve tambien el workspace_id del proyecto para reusarlo sin otra consulta.
 */
export async function canAccessProject(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  userId: string
): Promise<{ ok: boolean; workspaceId: string | null }> {
  const { data: project, error: projectErr } = (await admin
    .from('projects')
    .select('workspace_id')
    .eq('id', projectId)
    .maybeSingle()) as { data: { workspace_id: string } | null; error: unknown }
  if (projectErr) console.error('[canAccessProject] projects read error:', projectErr)
  if (!project?.workspace_id) return { ok: false, workspaceId: null }

  const { data: pm, error: pmErr } = (await admin
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }
  if (pmErr) console.error('[canAccessProject] project_members read error:', pmErr)
  if (pm) return { ok: true, workspaceId: project.workspace_id }

  const { data: profile } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle()) as { data: { org_role: string | null } | null; error: unknown }
  const orgRole = profile?.org_role ?? 'member'
  if (orgRole === 'owner' || orgRole === 'admin') {
    return { ok: true, workspaceId: project.workspace_id }
  }

  const { data: wsMember } = (await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', project.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }
  const ok = wsMember?.role === 'owner' || wsMember?.role === 'admin'
  return { ok, workspaceId: project.workspace_id }
}

/**
 * ¿Es `profileId` un asignable valido para tareas de `projectId`? Regla: debe ser
 * miembro del proyecto (project_members). Evita asignar tareas a usuarios que no
 * pertenecen al proyecto (o a UUIDs de otro workspace), lo que dejaria tareas
 * "huerfanas" apuntando a gente sin acceso. Se usa al crear y al reasignar tareas.
 * Fail-closed: ante un error de lectura se niega la asignacion.
 */
export async function isAssignableToProject(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  profileId: string
): Promise<boolean> {
  const { data: pm, error } = (await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', projectId)
    .eq('profile_id', profileId)
    .maybeSingle()) as { data: { profile_id: string } | null; error: unknown }
  if (error) {
    console.error('[isAssignableToProject] project_members read error:', error)
    return false
  }
  return pm != null
}

export async function isOrgAdmin(userId: string): Promise<boolean> {
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
export const resolveTeamForViewer = cache(async (
  workspaceSlug: string,
  teamSlug: string
): Promise<ViewerResult<TeamViewerContext>> => {
  const user = await getCachedUser()
  if (!user) return { ok: false, reason: 'no-auth' }

  const admin = createAdminClient()

  const wsRow = await resolveWorkspaceMembership(user.id, workspaceSlug)
  if (!wsRow || !wsRow.workspaces) return { ok: false, reason: 'not-found' }
  const workspace = wsRow.workspaces

  const { data: team } = (await admin
    .from('teams')
    .select('id, name, slug, description, workspace_id, methodology, is_archived, space_id, wip_limits')
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
})

/**
 * Resuelve un proyecto por slug para el visor (miembro del proyecto O admin del
 * workspace). Verifica coherencia con el team de la URL.
 */
export const resolveProjectForViewer = cache(async (
  workspaceSlug: string,
  teamSlug: string,
  projectSlug: string
): Promise<ViewerResult<ProjectViewerContext>> => {
  const user = await getCachedUser()
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
})

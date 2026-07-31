/**
 * Helpers de autorizacion para el panel de administracion del workspace.
 *
 * Un usuario es "admin del workspace" si:
 *   - su `profiles.org_role` es 'owner' o 'admin' (admin de la organizacion), o
 *   - su `workspace_members.role` es 'owner' o 'admin' en ESE workspace.
 *
 * Se usa el admin client (bypassa RLS) con checks explicitos de membresia,
 * igual que en el layout del workspace y en las rutas /api.
 */
import { cache } from 'react'
import { createAdminClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/auth'

export interface WorkspaceAdminContext {
  userId: string
  workspace: { id: string; name: string; slug: string; org_id: string; description: string | null }
  role: string
  isAdmin: boolean
}

/**
 * Resuelve el workspace por slug DESDE la membresia del usuario y calcula si es admin.
 * Devuelve null si no hay sesion o el usuario no es miembro de ese workspace.
 */
export const getWorkspaceAdminContext = cache(async (
  slug: string
): Promise<WorkspaceAdminContext | null> => {
  const user = await getCachedUser()
  if (!user) return null

  const admin = createAdminClient()

  type Row = {
    role: string
    workspaces: {
      id: string
      name: string
      slug: string
      org_id: string
      description: string | null
    } | null
  }

  const { data: row } = (await admin
    .from('workspace_members')
    .select('role, workspaces!inner ( id, name, slug, org_id, description )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', slug)
    .limit(1)
    .maybeSingle()) as { data: Row | null; error: unknown }

  if (!row || !row.workspaces) return null

  const { data: profile } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', user.id)
    .maybeSingle()) as { data: { org_role: string | null } | null; error: unknown }

  const orgRole = profile?.org_role ?? 'member'
  const isAdmin =
    orgRole === 'owner' ||
    orgRole === 'admin' ||
    row.role === 'owner' ||
    row.role === 'admin'

  return {
    userId: user.id,
    workspace: row.workspaces,
    role: row.role,
    isAdmin,
  }
})

/**
 * Variante para rutas /api: verifica que el user autenticado sea admin de un
 * workspace dado por ID. Devuelve { userId, isAdmin, isOwner, role } o null si
 * no hay sesion. `isOwner` (owner del workspace u owner de la org) es la barrera
 * para acciones que solo un owner puede hacer, como asignar el rol owner.
 */
export const isWorkspaceAdminById = cache(async (
  workspaceId: string
): Promise<{ userId: string; isAdmin: boolean; isOwner: boolean; role: string | null } | null> => {
  const user = await getCachedUser()
  if (!user) return null

  const admin = createAdminClient()

  const { data: membership } = (await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', user.id)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }

  const { data: profile } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', user.id)
    .maybeSingle()) as { data: { org_role: string | null } | null; error: unknown }

  const orgRole = profile?.org_role ?? 'member'
  const role = membership?.role ?? null
  const isOwner = orgRole === 'owner' || role === 'owner'
  const isAdmin =
    isOwner ||
    orgRole === 'admin' ||
    role === 'admin'

  return { userId: user.id, isAdmin, isOwner, role }
})

/**
 * ¿Puede este usuario PUBLICAR en el chat General del workspace?
 *
 * El canal General es de COMUNICADOS, no de conversacion: lo lee todo el
 * workspace pero solo escriben los mandos. La conversacion del dia a dia vive
 * en el chat por departamento/equipo, que ademas respeta el aislamiento de
 * departamentos restringidos.
 *
 * Cuenta como mando:
 *   a) admin/owner de la organizacion  (profiles.org_role)
 *   b) admin/owner del workspace       (workspace_members.role)
 *   c) lead de cualquier equipo del workspace (team_members.role = 'admin')
 *
 * (c) esta a proposito: el lead de Paid Media debe poder mandar un comunicado
 * sin ser admin de todo el sistema.
 *
 * Espeja `can_post_workspace_message()` de la migracion
 * 20260728000000_media_uploads_and_general_chat_roles.sql. Las rutas leen con el
 * admin client (bypassa RLS), asi que el candado tiene que existir en los dos
 * lados: aqui manda, la policy es la red de abajo.
 */
export async function canPostWorkspaceMessage(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const { data: profile } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle()) as { data: { org_role: string | null } | null; error: unknown }

  const orgRole = profile?.org_role ?? 'member'
  if (orgRole === 'owner' || orgRole === 'admin') return true

  const { data: membership } = (await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }

  if (membership?.role === 'owner' || membership?.role === 'admin') return true

  // Lead de algun equipo de ESTE workspace. El !inner acota a los equipos del
  // workspace: sin el, un lead de otro workspace pasaria el check.
  const { data: lead } = (await admin
    .from('team_members')
    .select('team_id, teams!inner ( workspace_id )')
    .eq('profile_id', userId)
    .eq('role', 'admin')
    .eq('teams.workspace_id', workspaceId)
    .limit(1)
    .maybeSingle()) as { data: { team_id: string } | null; error: unknown }

  return !!lead
}

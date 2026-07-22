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
 * workspace dado por ID. Devuelve { userId, isAdmin, role } o null si no hay sesion.
 */
export const isWorkspaceAdminById = cache(async (
  workspaceId: string
): Promise<{ userId: string; isAdmin: boolean; role: string | null } | null> => {
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
  const isAdmin =
    orgRole === 'owner' ||
    orgRole === 'admin' ||
    role === 'owner' ||
    role === 'admin'

  return { userId: user.id, isAdmin, role }
})

import 'server-only'
import type { createAdminClient } from '@/lib/supabase/server'

/**
 * Resolucion de permisos de un flujo.
 *
 * Antes esto no existia: las rutas solo miraban la membresia del workspace y el
 * campo visibility, asi que la tabla flow_shares se escribia pero nunca se
 * consultaba. Eso dejaba dos huecos: compartir un flujo privado no daba acceso
 * (el destinatario recibia 403) y un permiso de solo lectura no impedia editar.
 *
 * Reglas, en orden. La primera que aplica gana:
 *   1. Sin membresia en el workspace no hay acceso, aunque exista un share.
 *      Asi quien sale del workspace pierde el acceso automaticamente.
 *   2. Quien creo el flujo siempre puede editar.
 *   3. Admin del workspace y owner/admin de la organizacion siempre pueden editar.
 *   4. Un share explicito manda: define el techo de esa persona. Si dice "view",
 *      es solo lectura aunque por visibilidad tuviera edicion. Compartir es una
 *      declaracion de intencion deliberada y por eso pesa mas que la regla general.
 *   5. Un flujo privado sin share no se ve.
 *   6. Cualquier otro flujo visible para el workspace se puede editar, que es el
 *      comportamiento colaborativo que ya tenia el modulo.
 */

type Admin = ReturnType<typeof createAdminClient>

export type FlowAccess = 'none' | 'view' | 'edit'

export interface FlowAccessInput {
  flowId: string
  workspaceId: string
  createdBy: string | null
  visibility: string
  userId: string
}

export async function resolveFlowAccess(
  admin: Admin,
  input: FlowAccessInput,
): Promise<FlowAccess> {
  const { flowId, workspaceId, createdBy, visibility, userId } = input

  // 1. Membresia del workspace: requisito de entrada, incluso para un share.
  const { data: membership } = (await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string } | null; error: unknown }

  if (!membership) return 'none'

  // 2. El creador manda sobre lo suyo.
  if (createdBy === userId) return 'edit'

  // 3. Mando del workspace o de la organizacion.
  if (membership.role === 'admin') return 'edit'

  const { data: profile } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle()) as { data: { org_role: string | null } | null; error: unknown }

  if (profile?.org_role === 'owner' || profile?.org_role === 'admin') return 'edit'

  // 4. Share explicito: es el techo de esa persona, hacia arriba y hacia abajo.
  const { data: share } = (await admin
    .from('flow_shares')
    .select('permission')
    .eq('flow_id', flowId)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { permission: string } | null; error: unknown }

  if (share) return share.permission === 'edit' ? 'edit' : 'view'

  // 5. Privado sin share: invisible.
  if (visibility === 'private') return 'none'

  // 6. Resto: colaboracion abierta dentro del workspace.
  return 'edit'
}

/**
 * IDs de los flujos que le compartieron a esta persona. Lo usa el listado para
 * incluir los privados que le compartieron, que de otro modo no apareceran nunca.
 */
export async function sharedFlowIds(admin: Admin, userId: string): Promise<string[]> {
  const { data } = (await admin
    .from('flow_shares')
    .select('flow_id')
    .eq('profile_id', userId)) as { data: { flow_id: string }[] | null; error: unknown }

  return (data ?? []).map((row) => row.flow_id)
}

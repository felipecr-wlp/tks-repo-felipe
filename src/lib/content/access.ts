/**
 * Quien puede hacer que en el planificador de contenido.
 *
 * Todas las rutas /api leen con el admin client, que se salta RLS. O sea que el
 * candado REAL es este archivo y las policies de la migracion son la red de
 * abajo. Por eso la regla vive en un solo lugar: una regla de permisos
 * reimplementada en seis rutas se rompe en la sexta.
 *
 * La regla, en una linea: colaborar es de todos, decidir es de los mandos.
 *
 *   ver, subir, editar, comentar    cualquier miembro del workspace.
 *   aprobar, publicar, regresar     solo mando (owner/admin de la organizacion
 *                                   o del workspace).
 *   borrar la pieza                 quien la creo, o un mando.
 *
 * "Mando" es exactamente el mismo concepto que usa el panel de administracion y
 * el reporte diario. No se inventa un tercer tipo de jefe que se desincronice
 * de los otros dos.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import type { ContentStatus } from '@/lib/content/catalog'

type Admin = ReturnType<typeof createAdminClient>

/** Mando del workspace: owner/admin de la organizacion, o del workspace. */
export async function isContentManager(
  admin: Admin,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [{ data: profile }, { data: membership }] = await Promise.all([
    admin.from('profiles').select('org_role').eq('id', userId).maybeSingle(),
    admin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('profile_id', userId)
      .maybeSingle(),
  ])

  const orgRole = (profile as { org_role: string | null } | null)?.org_role ?? 'member'
  if (orgRole === 'owner' || orgRole === 'admin') return true

  const role = (membership as { role: string | null } | null)?.role ?? null
  return role === 'owner' || role === 'admin'
}

export interface ItemAccess {
  id: string
  workspace_id: string
  status: ContentStatus
  created_by: string | null
  /** Es miembro del workspace de la pieza. Sin esto no ve nada. */
  isMember: boolean
  /** Puede aprobar, publicar y regresar piezas. */
  isManager: boolean
  isCreator: boolean
}

/**
 * Sube de la pieza a su workspace y resuelve ahi los permisos.
 *
 * El workspace se resuelve por la RELACION, nunca por lo que mande el cliente:
 * un id de pieza es adivinable, la pertenencia no. Si el cliente pudiera decir
 * "esta pieza es del workspace X" bastaria con mentir para editar contenido
 * ajeno.
 */
export async function loadItemAccess(
  admin: Admin,
  itemId: string,
  userId: string,
): Promise<ItemAccess | null> {
  const { data } = (await admin
    .from('content_items')
    .select('id, workspace_id, status, created_by')
    .eq('id', itemId)
    .maybeSingle()) as {
    data: { id: string; workspace_id: string; status: ContentStatus; created_by: string | null } | null
  }

  if (!data) return null

  const { data: membership } = (await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', data.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string | null } | null }

  const isMember = Boolean(membership)
  // Si ni siquiera es miembro no se gasta una segunda consulta averiguando si es
  // mando: no lo puede ser de un workspace al que no pertenece.
  const isManager = isMember ? await isContentManager(admin, data.workspace_id, userId) : false

  return {
    id: data.id,
    workspace_id: data.workspace_id,
    status: data.status,
    created_by: data.created_by,
    isMember,
    isManager,
    isCreator: data.created_by === userId,
  }
}

/**
 * ¿Se puede pasar de este estado a este otro, y quien puede hacerlo?
 *
 * Devuelve null si la transicion esta permitida, o el mensaje de por que no.
 *
 * Las tres reglas que importan:
 *   - Aprobar y publicar son de mando. Es todo el punto de la herramienta: si
 *     cualquiera pudiera mover su propia pieza a "aprobado", la columna "por
 *     aprobar" quedaria siempre vacia y nadie revisaria nada.
 *   - Regresar una pieza publicada tambien es de mando, y ademas se registra:
 *     decir "esto ya salio" y luego borrar el rastro es como se pierde el
 *     historial.
 *   - No se salta de "por aprobar" a "publicado". Publicar algo que nadie
 *     aprobo es exactamente el accidente que esta pantalla evita.
 */
export function motivoParaNegarCambioDeEstado(
  desde: ContentStatus,
  hacia: ContentStatus,
  isManager: boolean,
): string | null {
  if (desde === hacia) return null

  if (desde === 'por_aprobar' && hacia === 'publicado') {
    return 'Una pieza no puede publicarse sin aprobarse antes.'
  }

  if (!isManager) {
    return 'Solo un administrador del workspace puede aprobar, publicar o regresar contenido.'
  }

  return null
}

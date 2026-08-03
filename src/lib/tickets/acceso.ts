/**
 * Quien puede ver y hacer que en las solicitudes.
 *
 * Todas las rutas /api leen con el admin client, que se salta RLS. O sea que el
 * candado REAL es este archivo y las policies de la migracion son la red de
 * abajo. Por eso la regla vive en un solo lugar: una regla de permisos
 * reimplementada en seis rutas se rompe en la sexta.
 *
 * ── Por que una solicitud no la ve todo el workspace ────────────────────────
 * Al reves que el planificador de contenido, que es material colectivo. Aqui lo
 * tipico es "el sistema de nomina calcula mal lo mio" o "necesito acceso a X".
 * Se ve por MOTIVO NOMBRABLE:
 *
 *   quien la pidio            es suya.
 *   quien quedo a cargo       le toca hacerla.
 *   a quien involucraron      lo metieron a proposito (ticket_watchers).
 *   el departamento destino   va dirigida a ellos.
 *   los mandos                deciden, asi que ven todo. Es el filtro que pidio
 *                             el negocio: nada se canaliza a espaldas del admin.
 *
 * `esMando` es exactamente el mismo concepto que usa el panel de administracion,
 * el reporte diario y el planificador de contenido. No se inventa un cuarto tipo
 * de jefe que se desincronice de los otros tres.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import type { EstadoSolicitud } from './flujo-solicitud'

type Admin = ReturnType<typeof createAdminClient>

/** Mando del workspace: owner/admin de la organizacion, o del workspace. */
export async function esMando(
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

export interface SolicitudScope {
  id: string
  workspace_id: string
  status: EstadoSolicitud
  requested_by: string | null
  assignee_id: string | null
  space_id: string | null
  /** Es miembro del workspace de la solicitud. Sin esto no ve nada. */
  esMiembroDelWorkspace: boolean
  esSolicitante: boolean
  esResponsable: boolean
  esAdmin: boolean
  /** Lo involucraron explicitamente (ticket_watchers). */
  esInvolucrado: boolean
  /** Pertenece al departamento al que se dirigio. */
  esDelDepartamento: boolean
}

/** ¿Tiene algun motivo nombrable para ver esta solicitud? */
export function puedeVer(s: SolicitudScope): boolean {
  if (!s.esMiembroDelWorkspace) return false
  return (
    s.esSolicitante ||
    s.esResponsable ||
    s.esAdmin ||
    s.esInvolucrado ||
    s.esDelDepartamento
  )
}

/**
 * Sube de la solicitud a su workspace y resuelve ahi los permisos.
 *
 * El workspace se resuelve por la RELACION, nunca por lo que mande el cliente:
 * un id de solicitud es adivinable, la pertenencia no. Si el cliente pudiera
 * decir "esta solicitud es del workspace X" bastaria con mentir para leer
 * peticiones ajenas.
 */
export async function cargarSolicitud(
  admin: Admin,
  ticketId: string,
  userId: string,
): Promise<SolicitudScope | null> {
  const { data } = (await admin
    .from('tickets')
    .select('id, workspace_id, status, requested_by, assignee_id, space_id')
    .eq('id', ticketId)
    .maybeSingle()) as {
    data: {
      id: string
      workspace_id: string
      status: EstadoSolicitud
      requested_by: string | null
      assignee_id: string | null
      space_id: string | null
    } | null
  }

  if (!data) return null

  const { data: membership } = (await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', data.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle()) as { data: { role: string | null } | null }

  const esMiembroDelWorkspace = Boolean(membership)

  // Si ni siquiera es miembro del workspace no se gastan tres consultas mas
  // averiguando si lo involucraron: no se puede involucrar a quien no esta.
  if (!esMiembroDelWorkspace) {
    return {
      ...data,
      esMiembroDelWorkspace: false,
      esSolicitante: false,
      esResponsable: false,
      esAdmin: false,
      esInvolucrado: false,
      esDelDepartamento: false,
    }
  }

  const [esAdmin, involucrado, delDepto] = await Promise.all([
    esMando(admin, data.workspace_id, userId),
    admin
      .from('ticket_watchers')
      .select('profile_id')
      .eq('ticket_id', data.id)
      .eq('profile_id', userId)
      .maybeSingle()
      .then((r) => Boolean(r.data)),
    data.space_id
      ? admin
          .from('space_members')
          .select('profile_id')
          .eq('space_id', data.space_id)
          .eq('profile_id', userId)
          .maybeSingle()
          .then((r) => Boolean(r.data))
      : Promise.resolve(false),
  ])

  return {
    ...data,
    esMiembroDelWorkspace,
    esSolicitante: data.requested_by === userId,
    esResponsable: data.assignee_id === userId,
    esAdmin,
    esInvolucrado: involucrado,
    esDelDepartamento: delDepto,
  }
}

/**
 * Los ids de solicitud que esta persona puede ver en este workspace.
 *
 * Existe como funcion aparte del listado porque el filtro es una UNION de cinco
 * motivos y PostgREST no sabe expresar "o pertenezco al departamento destino" en
 * un solo `.or()` sin subconsulta. Se resuelve en dos pasos: primero los ids por
 * las relaciones (watcher, departamento), luego una sola lectura del tablero.
 *
 * Devuelve `null` cuando la persona es mando: entonces no hay filtro que aplicar
 * y agregarlo solo costaria consultas. `null` significa "todas", y quien lo
 * llama tiene que tratarlo asi de forma explicita.
 */
export async function idsVisibles(
  admin: Admin,
  workspaceId: string,
  userId: string,
): Promise<string[] | null> {
  if (await esMando(admin, workspaceId, userId)) return null

  const [propias, aCargo, involucrado, misDeptos] = await Promise.all([
    admin.from('tickets').select('id').eq('workspace_id', workspaceId).eq('requested_by', userId),
    admin.from('tickets').select('id').eq('workspace_id', workspaceId).eq('assignee_id', userId),
    admin.from('ticket_watchers').select('ticket_id').eq('profile_id', userId),
    admin.from('space_members').select('space_id').eq('profile_id', userId),
  ])

  const ids = new Set<string>()
  for (const r of (propias.data ?? []) as { id: string }[]) ids.add(r.id)
  for (const r of (aCargo.data ?? []) as { id: string }[]) ids.add(r.id)
  for (const r of (involucrado.data ?? []) as { ticket_id: string }[]) ids.add(r.ticket_id)

  const spaceIds = ((misDeptos.data ?? []) as { space_id: string }[]).map((r) => r.space_id)
  if (spaceIds.length > 0) {
    const { data } = await admin
      .from('tickets')
      .select('id')
      .eq('workspace_id', workspaceId)
      .in('space_id', spaceIds)
    for (const r of (data ?? []) as { id: string }[]) ids.add(r.id)
  }

  return [...ids]
}

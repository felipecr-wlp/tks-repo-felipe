/**
 * Quien puede LEER el reporte diario de alguien mas.
 *
 * Modelo unico de verdad. Toda la app (la pantalla, las rutas /api, el agente y
 * las herramientas de KERN) pregunta AQUI, porque una regla de privacidad que
 * se reimplementa en cuatro lugares se rompe en el cuarto: basta con que una
 * herramienta del chat se olvide del candado para que la privacidad no exista.
 *
 * La regla:
 *   - Tu reporte es tuyo. Siempre lo ves y eres el unico que lo escribe.
 *   - El de los demas lo ven SOLO los mandos: admin/owner de la organizacion, o
 *     admin/owner de ESE workspace. Es el mismo criterio que usa
 *     `workspace-admin.ts` para el panel de administracion, para no inventar un
 *     segundo concepto de "jefe" que se desincronice del primero.
 *   - Ni un admin escribe el dia de otro. Leer y firmar son cosas distintas.
 *
 * Las rutas leen con el admin client (bypassa RLS), asi que el candado real es
 * este archivo; las policies de la migracion son la red de abajo.
 */
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

/**
 * ¿Este usuario puede ver los reportes de las demas personas de este workspace?
 *
 * Dos consultas y no una: el rol de organizacion vive en `profiles` y el del
 * workspace en `workspace_members`. Se piden en paralelo porque son
 * independientes.
 */
export async function isReportSupervisor(
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

  const orgRole = profile?.org_role ?? 'member'
  if (orgRole === 'owner' || orgRole === 'admin') return true

  const role = membership?.role ?? null
  return role === 'owner' || role === 'admin'
}

/**
 * Los mandos de ESTE workspace, para avisarles de algo (hoy: un bloqueo).
 *
 * Es la contraparte de `isReportSupervisor`: aquella pregunta "¿este usuario es
 * mando?", esta responde "¿quienes lo son?". Comparte deliberadamente el mismo
 * criterio (admin/owner de la organizacion, o admin/owner del workspace) para
 * que no puedan divergir: seria absurdo que alguien pudiera leer el reporte de
 * un bloqueo pero nunca enterarse de que existe.
 *
 * Solo se consideran mandos que SEAN miembros del workspace. Un admin de la
 * organizacion que no pertenece a este equipo no recibe el aviso: no tiene el
 * contexto para desatorarlo y llenarle la bandeja es la forma mas rapida de que
 * deje de mirarla.
 */
export async function listReportSupervisors(
  admin: Admin,
  workspaceId: string,
  excludeUserId?: string,
): Promise<string[]> {
  const { data: members } = (await admin
    .from('workspace_members')
    .select('profile_id, role')
    .eq('workspace_id', workspaceId)
    .limit(500)) as { data: { profile_id: string; role: string | null }[] | null }

  const rows = members ?? []
  if (rows.length === 0) return []

  // Una sola consulta para los roles de organizacion de todo el equipo: pedir
  // uno por miembro convertiria un workspace de doce personas en doce viajes.
  const { data: profiles } = (await admin
    .from('profiles')
    .select('id, org_role')
    .in(
      'id',
      rows.map(r => r.profile_id),
    )) as { data: { id: string; org_role: string | null }[] | null }

  const orgRole = new Map((profiles ?? []).map(p => [p.id, p.org_role ?? 'member']))

  const ids = rows
    .filter(r => {
      const org = orgRole.get(r.profile_id) ?? 'member'
      return org === 'owner' || org === 'admin' || r.role === 'owner' || r.role === 'admin'
    })
    .map(r => r.profile_id)
    .filter(id => id !== excludeUserId)

  return Array.from(new Set(ids))
}

export interface EntryOwnership {
  entry_id: string
  report_id: string
  /** Dueño del reporte: el unico que puede editar o adjuntar. */
  profile_id: string
  workspace_id: string
}

/**
 * Sube de una actividad a su reporte para saber de quien es.
 *
 * Se resuelve por la relacion y nunca por lo que mande el cliente: el id de una
 * entrada es adivinable, la pertenencia no. Es el mismo criterio que ya usa el
 * DELETE de actividades.
 */
export async function loadEntryOwnership(
  admin: Admin,
  entryId: string,
): Promise<EntryOwnership | null> {
  const { data } = (await admin
    .from('daily_report_entries')
    .select('id, report:daily_reports ( id, profile_id, workspace_id )')
    .eq('id', entryId)
    .maybeSingle()) as {
    data: {
      id: string
      report: { id: string; profile_id: string; workspace_id: string } | null
    } | null
  }

  if (!data?.report) return null
  return {
    entry_id: data.id,
    report_id: data.report.id,
    profile_id: data.report.profile_id,
    workspace_id: data.report.workspace_id,
  }
}

/**
 * ¿Puede este usuario VER esta actividad (y su evidencia)?
 * Dueño siempre; los demas solo si son mando del workspace del reporte.
 */
export async function canViewEntry(
  admin: Admin,
  owner: EntryOwnership,
  userId: string,
): Promise<boolean> {
  if (owner.profile_id === userId) return true
  return isReportSupervisor(admin, owner.workspace_id, userId)
}

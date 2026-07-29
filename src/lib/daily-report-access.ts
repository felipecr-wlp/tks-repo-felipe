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

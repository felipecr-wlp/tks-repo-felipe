/**
 * Un bloqueo del reporte diario tiene que salir de la pantalla.
 *
 * ── El problema ──────────────────────────────────────────────────────────────
 * Hasta ahora registrar un bloqueo y registrar un avance costaban lo mismo y
 * pasaban lo mismo: nada. La persona escribia "estoy atorado esperando el
 * acceso al servidor", quedaba una linea gris en su dia, y quien podia
 * desatorarlo se enteraba al dia siguiente en la junta, si es que alguien leia
 * el reporte. Un canal donde pedir ayuda no sirve de nada es un canal donde la
 * gente deja de pedir ayuda: se guarda el bloqueo y lo resuelve como puede, que
 * es justo la conducta que el reporte queria eliminar.
 *
 * De las cuatro categorias, `bloqueo` es la UNICA que por definicion involucra a
 * alguien mas. Avance, siguiente y nota son informacion. Un bloqueo es una
 * peticion. Por eso es el unico que notifica.
 *
 * ── Por que aqui y no dentro de cada herramienta ─────────────────────────────
 * Hay dos bocas que escriben actividades (BITACORA y KERN) y mañana puede haber
 * una tercera (el formulario, una automatizacion). Si la escalacion vive dentro
 * de cada una, basta con que la tercera se olvide para que el bloqueo vuelva a
 * morir en silencio, y nadie lo notaria: no falla nada, simplemente no pasa
 * nada. Aqui esta una vez.
 *
 * ── Best effort a proposito ─────────────────────────────────────────────────
 * Nunca lanza. Que falle el aviso no puede tumbar el registro: es peor perder la
 * actividad que perder la notificacion, porque la actividad no se vuelve a
 * escribir y el aviso siempre se puede recuperar mirando el reporte.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import { notify, NotificationTypes } from '@/lib/activity'
import { listReportSupervisors } from '@/lib/daily-report-access'

type Admin = ReturnType<typeof createAdminClient>

interface BlockerParams {
  admin: Admin
  workspaceId: string
  /** Quien reporta el bloqueo. Nunca se autonotifica. */
  userId: string
  /** Dia del reporte (YYYY-MM-DD). Viaja en el titulo, ver abajo. */
  date: string
  content: string
}

/**
 * Avisa a los mandos del workspace que alguien esta atorado.
 *
 * El `object_title` lleva la FECHA, no el texto del bloqueo, porque la bandeja
 * ya interpreta asi las notificaciones de tipo `daily_report`: usa ese campo
 * para armar el enlace `/reportes?d=<fecha>`. Meter ahi la frase del bloqueo
 * romperia el unico camino que tiene el mando para llegar al reporte, que es
 * justo lo que se quiere que haga.
 */
export async function notifyReportBlocker(params: BlockerParams): Promise<void> {
  const { admin, workspaceId, userId, date } = params

  try {
    const supervisors = await listReportSupervisors(admin, workspaceId, userId)
    if (supervisors.length === 0) return

    // En paralelo: son escrituras independientes y esperar una por una alargaria
    // la respuesta del agente por algo que la persona ni siquiera ve.
    await Promise.all(
      supervisors.map(recipient =>
        notify({
          workspace_id: workspaceId,
          recipient_id: recipient,
          subject_id: userId,
          type: NotificationTypes.DAILY_REPORT_BLOCKER,
          object_type: 'daily_report',
          object_title: date,
        }),
      ),
    )
  } catch (error) {
    console.error('[notifyReportBlocker] error:', error)
  }
}

/**
 * Avisa que un bloqueo ya se resolvio.
 *
 * ── Por que tambien se notifica el cierre ───────────────────────────────────
 * Una alerta que solo abre y nunca cierra se vuelve ruido en dos semanas: el
 * mando acumula avisos de cosas que ya se destrabaron, deja de abrirlos, y para
 * cuando llega uno real ya no lo lee. El cierre es lo que hace que el aviso de
 * apertura siga valiendo algo.
 *
 * Mismo contrato que la apertura: el `object_title` lleva la FECHA del reporte
 * donde nacio el bloqueo, no la de hoy, porque a donde tiene que llevar el
 * enlace es al dia donde esta escrito.
 */
export async function notifyBlockerResolved(params: BlockerParams): Promise<void> {
  const { admin, workspaceId, userId, date } = params

  try {
    const supervisors = await listReportSupervisors(admin, workspaceId, userId)
    if (supervisors.length === 0) return

    await Promise.all(
      supervisors.map(recipient =>
        notify({
          workspace_id: workspaceId,
          recipient_id: recipient,
          subject_id: userId,
          type: NotificationTypes.DAILY_REPORT_UNBLOCKED,
          object_type: 'daily_report',
          object_title: date,
        }),
      ),
    )
  } catch (error) {
    console.error('[notifyBlockerResolved] error:', error)
  }
}

export interface BloqueoAbierto {
  entry_id: string
  date: string
  content: string
  /** Dias que lleva detenido. Es el numero que de verdad importa. */
  dias: number
}

/**
 * Los bloqueos de esta persona que siguen abiertos, del mas viejo al mas nuevo.
 *
 * Se busca en una ventana de 30 dias y no en toda la historia: un bloqueo que
 * lleva un mes sin resolverse ya no es un bloqueo, es una decision que nadie
 * tomo, y arrastrarlo para siempre en el contexto del agente solo ensucia la
 * conversacion.
 *
 * Nunca lanza: sin esta lista el agente sigue funcionando, solo con menos
 * memoria.
 */
export async function listOpenBlockers(
  admin: Admin,
  scope: { workspaceId: string; userId: string; date: string; days?: number },
): Promise<BloqueoAbierto[]> {
  const { workspaceId, userId, date, days = 30 } = scope

  try {
    const desde = new Date(`${date}T12:00:00Z`)
    desde.setUTCDate(desde.getUTCDate() - days)

    const { data: reports } = (await admin
      .from('daily_reports')
      .select('id, report_date')
      .eq('workspace_id', workspaceId)
      .eq('profile_id', userId)
      .gte('report_date', desde.toISOString().slice(0, 10))
      .lte('report_date', date)
      .limit(60)) as { data: { id: string; report_date: string }[] | null }

    const rows = reports ?? []
    if (rows.length === 0) return []

    const fechaPorReporte = new Map(rows.map(r => [r.id, r.report_date]))

    const { data: entries } = (await admin
      .from('daily_report_entries')
      .select('id, report_id, content')
      .in(
        'report_id',
        rows.map(r => r.id),
      )
      .eq('category', 'bloqueo')
      .is('resolved_at', null)
      .limit(50)) as { data: { id: string; report_id: string; content: string }[] | null }

    const hoy = new Date(`${date}T12:00:00Z`).getTime()

    return (entries ?? [])
      .map(e => {
        const d = fechaPorReporte.get(e.report_id) ?? date
        return {
          entry_id: e.id,
          date: d,
          content: e.content,
          dias: Math.round((hoy - new Date(`${d}T12:00:00Z`).getTime()) / 86400000),
        }
      })
      .sort((a, b) => b.dias - a.dias)
  } catch (error) {
    console.error('[listOpenBlockers] error:', error)
    return []
  }
}

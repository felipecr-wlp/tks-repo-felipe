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

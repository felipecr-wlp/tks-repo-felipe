/**
 * logActivity, registra eventos en activity_events y crea notificaciones.
 * Llamar desde Route Handlers después de cada mutación importante.
 *
 * Uso:
 *   await logActivity({
 *     verb: ActivityVerbs.TASK_CREATED,
 *     subject_id: user.id,
 *     object_type: 'task',
 *     object_id: task.id,
 *     object_title: task.title,
 *     workspace_id: task.workspace_id,
 *     project_id: task.project_id,
 *   })
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { sendEmail, renderNotificationEmail, isEmailConfigured } from './email'

/**
 * Cliente sin genérico Database para operaciones de logging (service_role).
 * Los tipos reales se generan con `npm run db:generate-types`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLogClient(): any {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    // Fail-fast: sin service role las escrituras fallarían contra RLS de forma
    // silenciosa y confusa. Mejor tronar con mensaje claro de configuración.
    throw new Error('SUPABASE_SERVICE_ROLE_KEY no configurada (requerida por logActivity).')
  }
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface LogActivityParams {
  verb: string
  subject_id: string          // actor (user.id)
  object_type: string         // 'task' | 'project' | 'note' | etc.
  object_id: string
  object_title?: string
  workspace_id: string
  project_id?: string
  metadata?: Record<string, unknown>
}

interface NotifyParams {
  recipient_id: string
  subject_id: string
  type: string
  object_type?: string
  object_id?: string
  object_title?: string
  workspace_id: string
}

export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    const supabase = getLogClient()

    await supabase.from('activity_events').insert({
      workspace_id: params.workspace_id,
      project_id:   params.project_id ?? null,
      subject_id:   params.subject_id,
      verb:         params.verb,
      object_type:  params.object_type,
      object_id:    params.object_id,
      object_title: params.object_title ?? null,
      metadata:     params.metadata ?? null,
    })
  } catch (error) {
    // No romper el flujo principal si el log falla
    console.error('[logActivity] Error:', error)
  }
}

/**
 * Ventana de una SESION de edicion, en minutos. Dentro de esta ventana, la misma
 * persona editando el mismo objeto cuenta como UNA sola accion.
 */
const EDIT_SESSION_MINUTES = 30

/**
 * logActivityCoalesced, para verbos de EDICION CONTINUA (pizarra, nota, tarea).
 *
 * El problema que resuelve: la pizarra autoguarda cada pocos segundos y cada
 * guardado llamaba a logActivity. Medido en produccion el 2026-07-28: 2,410 de
 * 2,922 eventos totales eran 'whiteboard.updated', el 82% de la bitacora, unos
 * 345 renglones por pizarra. La actividad de verdad quedaba sepultada.
 *
 * La regla: si la MISMA persona sigue editando el MISMO objeto dentro de la
 * ventana, no se inserta otro renglon. Se actualiza el que ya existe (se recorre
 * su `created_at` al momento actual y se sube el contador `metadata.edits`), de
 * forma que el feed muestre "actualizo la pizarra X · 27 ediciones" en vez de 27
 * renglones. Fuera de la ventana nace un renglon nuevo: es una sesion distinta.
 *
 * El historial que ya estaba escrito se marco con `is_superseded` en la
 * migracion 20260728030000. Los lectores del feed filtran por esa columna.
 *
 * Nunca lanza: si el log falla, la mutacion del usuario ya ocurrio y no se
 * revierte por un renglon de bitacora.
 */
export async function logActivityCoalesced(params: LogActivityParams): Promise<void> {
  try {
    const supabase = getLogClient()
    const desde = new Date(Date.now() - EDIT_SESSION_MINUTES * 60_000).toISOString()

    const { data: previo } = await supabase
      .from('activity_events')
      .select('id, metadata')
      .eq('workspace_id', params.workspace_id)
      .eq('subject_id',   params.subject_id)
      .eq('verb',         params.verb)
      .eq('object_type',  params.object_type)
      .eq('object_id',    params.object_id)
      .eq('is_superseded', false)
      .gte('created_at',  desde)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (previo?.id) {
      const metaPrevio = (previo.metadata ?? {}) as Record<string, unknown>
      const ediciones = typeof metaPrevio.edits === 'number' ? metaPrevio.edits : 1

      await supabase
        .from('activity_events')
        .update({
          // Se recorre la marca de tiempo: la sesion sigue viva y el feed debe
          // ordenarla por la ultima edicion, no por la primera.
          created_at:   new Date().toISOString(),
          object_title: params.object_title ?? null,
          metadata:     { ...metaPrevio, ...(params.metadata ?? {}), edits: ediciones + 1 },
        })
        .eq('id', previo.id)
      return
    }

    await supabase.from('activity_events').insert({
      workspace_id: params.workspace_id,
      project_id:   params.project_id ?? null,
      subject_id:   params.subject_id,
      verb:         params.verb,
      object_type:  params.object_type,
      object_id:    params.object_id,
      object_title: params.object_title ?? null,
      metadata:     params.metadata ?? null,
    })
  } catch (error) {
    console.error('[logActivityCoalesced] Error:', error)
  }
}

/**
 * Tipos de notificacion que MERECEN correo (eventos de alto valor accionados por
 * una persona). Se excluyen los ruidosos / de sistema (task_updated, overdue,
 * due_soon, recurrence, review_requested). Cada uno mapea a la frase del asunto
 * y una etiqueta generica del objeto.
 */
const EMAIL_NOTIFY: Record<string, { phrase: string; objectLabel: string }> = {
  task_mentioned:        { phrase: 'te menciono en',            objectLabel: 'una tarea' },
  note_mentioned:        { phrase: 'te menciono en',            objectLabel: 'una nota' },
  task_commented:        { phrase: 'comento en',               objectLabel: 'una tarea' },
  task_assigned:         { phrase: 'te asigno',                objectLabel: 'una tarea' },
  reminder:              { phrase: 'te recuerda',              objectLabel: 'algo' },
  application_submitted: { phrase: 'se postulo a',             objectLabel: 'tu proyecto' },
  application_accepted:  { phrase: 'acepto tu postulacion a',  objectLabel: 'un proyecto' },
  application_rejected:  { phrase: 'actualizo tu postulacion a', objectLabel: 'un proyecto' },
  project_approved:      { phrase: 'aprobo tu proyecto',       objectLabel: 'un proyecto' },
  project_rejected:      { phrase: 'reviso tu proyecto',       objectLabel: 'un proyecto' },
  project_pending_approval: { phrase: 'propuso un proyecto por aprobar', objectLabel: 'un proyecto' },
  // Un bloqueo es, por definicion, algo que la persona NO puede desatorar sola.
  // Es el unico evento del reporte diario que amerita salir de la app: si el
  // aviso espera a que el mando abra la bandeja, el equipo pierde el dia.
  daily_report_blocker:  { phrase: 'reporto un bloqueo en',     objectLabel: 'su reporte del dia' },
  // OJO: `daily_report_unblocked` NO esta aqui a proposito. Que algo se haya
  // resuelto es buena noticia, y las buenas noticias no justifican un correo:
  // basta con que la bandeja deje de mostrarlo como pendiente. Mandar correo por
  // cada cierre convertiria la alerta de bloqueo en algo que se filtra.
}

/**
 * Envia (best effort, gateado) el correo de una notificacion. No-op si el email
 * no esta configurado o el tipo no amerita correo. Nunca lanza.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function maybeSendNotificationEmail(supabase: any, params: NotifyParams): Promise<void> {
  try {
    if (!isEmailConfigured()) return
    const spec = EMAIL_NOTIFY[params.type]
    if (!spec) return
    if (params.recipient_id === params.subject_id) return // no auto-correo

    const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? ''

    const [{ data: recipient }, { data: actor }, { data: ws }] = await Promise.all([
      supabase.from('profiles').select('email, display_name, email_notifications').eq('id', params.recipient_id).maybeSingle(),
      supabase.from('profiles').select('display_name').eq('id', params.subject_id).maybeSingle(),
      supabase.from('workspaces').select('slug').eq('id', params.workspace_id).maybeSingle(),
    ])

    if (!recipient?.email) return
    // Preferencia por usuario (Circuito 2.B): si opto por NO recibir correos, se
    // respeta. La notificacion in-app (Bandeja) siempre se crea; solo el correo
    // es opt-out. La columna es DEFAULT true, asi que null/undefined = enviar.
    if (recipient.email_notifications === false) return

    const slug = ws?.slug as string | undefined
    const url =
      params.object_type === 'task' && params.object_id && slug
        ? `${base}/w/${slug}/task/${params.object_id}`
        : slug
          ? `${base}/w/${slug}/inbox`
          : base || '#'

    const { subject, html } = renderNotificationEmail({
      recipientName: (recipient.display_name as string | null) ?? 'Hola',
      actorName: (actor?.display_name as string | null) ?? 'Alguien',
      phrase: spec.phrase,
      objectLabel: spec.objectLabel,
      objectTitle: params.object_title ?? null,
      url,
    })

    await sendEmail({ to: recipient.email as string, subject, html })
  } catch (error) {
    console.error('[maybeSendNotificationEmail] Error:', error)
  }
}

export async function createNotification(params: NotifyParams): Promise<void> {
  try {
    const supabase = getLogClient()

    await supabase.from('notifications').insert({
      workspace_id: params.workspace_id,
      recipient_id: params.recipient_id,
      subject_id:   params.subject_id,
      type:         params.type,
      object_type:  params.object_type ?? null,
      object_id:    params.object_id ?? null,
      object_title: params.object_title ?? null,
    })

    // Correo best effort (gateado por config). No bloquea si falla.
    await maybeSendNotificationEmail(supabase, params)
  } catch (error) {
    console.error('[createNotification] Error:', error)
  }
}

/**
 * notify(), helper unico canonico de notificacion (Circuito 2.A). Escribe la
 * notificacion in-app (Bandeja) y, si el tipo lo amerita y el usuario no opto por
 * salirse, dispara el correo. Es el nombre preferido; createNotification queda
 * como alias por compatibilidad con las rutas ya existentes.
 */
export const notify = createNotification

/**
 * Notifica a los SEGUIDORES (watchers) de una tarea que se actualizo, excepto al
 * actor que hizo el cambio. Best effort: no rompe el flujo principal si falla.
 * Circuito B10. Reusa la tabla notifications ya existente.
 */
export async function notifyTaskWatchers(params: {
  taskId: string
  actorId: string
  taskTitle: string
  workspaceId: string
  /** Tipo de notificacion. Por defecto TASK_UPDATED (cambio de campo). Para un
   *  comentario nuevo se pasa TASK_COMMENTED, asi la bandeja muestra la frase
   *  correcta. */
  notifType?: string
}): Promise<void> {
  try {
    const supabase = getLogClient()

    const { data: watchers } = await supabase
      .from('task_watchers')
      .select('profile_id')
      .eq('task_id', params.taskId)

    const recipients: string[] = (watchers ?? [])
      .map((w: { profile_id: string }) => w.profile_id)
      .filter((id: string) => id !== params.actorId)

    if (recipients.length === 0) return

    const rows = recipients.map(recipient_id => ({
      workspace_id: params.workspaceId,
      recipient_id,
      subject_id:   params.actorId,
      type:         params.notifType ?? NotificationTypes.TASK_UPDATED,
      object_type:  'task',
      object_id:    params.taskId,
      object_title: params.taskTitle,
    }))

    await supabase.from('notifications').insert(rows)

    // Correo best effort a cada seguidor (gateado por config). El tipo por
    // defecto (task_updated) no esta en EMAIL_NOTIFY, asi que solo dispara
    // correo cuando se pasa un tipo emailable (ej. task_commented).
    if (isEmailConfigured()) {
      await Promise.all(
        recipients.map(recipient_id =>
          maybeSendNotificationEmail(supabase, {
            recipient_id,
            subject_id:   params.actorId,
            type:         params.notifType ?? NotificationTypes.TASK_UPDATED,
            object_type:  'task',
            object_id:    params.taskId,
            object_title: params.taskTitle,
            workspace_id: params.workspaceId,
          })
        )
      )
    }
  } catch (error) {
    console.error('[notifyTaskWatchers] Error:', error)
  }
}

/**
 * Verbs estándar, usar siempre estos para consistencia
 */
export const ActivityVerbs = {
  // Tasks
  TASK_CREATED:        'task.created',
  TASK_UPDATED:        'task.updated',
  TASK_DELETED:        'task.deleted',
  TASK_ARCHIVED:       'task.archived',
  TASK_STATUS_CHANGED: 'task.status_changed',
  TASK_ASSIGNED:       'task.assigned',
  TASK_UNASSIGNED:     'task.unassigned',
  TASK_PRIORITY_SET:   'task.priority_set',
  TASK_DUE_SET:        'task.due_set',
  // Comments
  COMMENT_ADDED:       'comment.added',
  COMMENT_UPDATED:     'comment.updated',
  // Menciones (Conv B: colaboracion en tareas)
  TASK_MENTIONED:      'task.mentioned',
  // Projects
  PROJECT_CREATED:     'project.created',
  PROJECT_ARCHIVED:    'project.archived',
  PROJECT_MEMBER_ADDED: 'project.member_added',
  PROJECT_PROPOSED:    'project.proposed',
  PROJECT_APPROVED:    'project.approved',
  PROJECT_REJECTED:    'project.rejected',
  PROJECT_COMPLETED:   'project.completed',
  // Marketplace de proyectos (postulaciones + liderazgo + reviews)
  PROJECT_CHARTER_UPDATED:  'project.charter_updated',
  PROJECT_OPENED:           'project.opened',
  PROJECT_CLOSED:           'project.closed',
  APPLICATION_SUBMITTED:    'application.submitted',
  APPLICATION_ACCEPTED:     'application.accepted',
  APPLICATION_REJECTED:     'application.rejected',
  APPLICATION_WITHDRAWN:    'application.withdrawn',
  REVIEW_SUBMITTED:         'review.submitted',
  // Notes
  NOTE_CREATED:        'note.created',
  NOTE_UPDATED:        'note.updated',
  NOTE_COMMENTED:      'note.commented',
  NOTE_MENTIONED:      'note.mentioned',
  // Whiteboards
  WHITEBOARD_CREATED:  'whiteboard.created',
  WHITEBOARD_UPDATED:  'whiteboard.updated',
  // Flows
  FLOW_CREATED:        'flow.created',
  FLOW_UPDATED:        'flow.updated',
  // Workspace
  WORKSPACE_INVITE_CREATED: 'workspace.invite_created',
  WORKSPACE_INVITE_REVOKED: 'workspace.invite_revoked',
  WORKSPACE_MEMBER_JOINED:  'workspace.member_joined',
} as const

/**
 * Tipos de notificacion, para la campana del inbox.
 */
export const NotificationTypes = {
  APPLICATION_SUBMITTED: 'application_submitted', // al lider: alguien se postulo
  APPLICATION_ACCEPTED:  'application_accepted',  // al postulante: aceptado
  APPLICATION_REJECTED:  'application_rejected',  // al postulante: rechazado
  REVIEW_REQUESTED:      'review_requested',      // recordatorio de calificar companeros
  PROJECT_APPROVED:      'project_approved',      // al proponente: su proyecto fue aprobado
  PROJECT_REJECTED:      'project_rejected',      // al proponente: su proyecto fue rechazado
  PROJECT_PENDING_APPROVAL: 'project_pending_approval', // a admins: hay un proyecto por aprobar
  TASK_MENTIONED:        'task_mentioned',        // al mencionado: te nombraron en una tarea
  TASK_ASSIGNED:         'task_assigned',         // al asignado: te asignaron una tarea (Circuito 2.A)
  NOTE_MENTIONED:        'note_mentioned',        // al mencionado: te nombraron en un comentario de nota
  TASK_UPDATED:          'task_updated',          // al seguidor: se actualizo una tarea que sigues
  TASK_COMMENTED:        'task_commented',        // al seguidor: alguien comento en una tarea que sigues
  TASK_OVERDUE:          'task_overdue',          // al asignado: tarea vencida (recordatorio diario, sistema)
  TASK_DUE_SOON:         'task_due_soon',         // al asignado: tarea vence hoy (recordatorio diario, sistema)
  TASK_RECURRENCE_CREATED: 'task_recurrence_created', // al asignado: se genero la siguiente ocurrencia recurrente
  SOP_REVIEW_OVERDUE:    'sop_review_overdue',    // al owner del SOP: la fecha de revision ya paso (recordatorio diario, sistema)
  SOP_REVIEW_DUE_SOON:   'sop_review_due_soon',   // al owner del SOP: la revision vence dentro de 7 dias (recordatorio diario, sistema)
  SOP_ASSIGNED:          'sop_assigned',          // al lector requerido: debes leer y confirmar este documento
  DAILY_REPORT_MISSING:  'daily_report_missing',  // a la persona: termina el dia sin actividades registradas (recordatorio, sistema)
  DAILY_REPORT_BLOCKER:  'daily_report_blocker',  // a los mandos: alguien del equipo esta atorado y necesita que lo desatoren
  DAILY_REPORT_UNBLOCKED: 'daily_report_unblocked', // a los mandos: ese bloqueo ya se resolvio (cierra el ciclo, sin correo)
  REMINDER:              'reminder',              // recordatorio programado desde el chat (Circuito 1.C)
  AUTOMATION:            'automation',            // aviso disparado por una regla de automatizacion (Circuito 3)
} as const

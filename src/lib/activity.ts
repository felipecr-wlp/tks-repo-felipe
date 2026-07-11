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

/**
 * Cliente sin genérico Database para operaciones de logging (service_role).
 * Los tipos reales se generan con `npm run db:generate-types`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLogClient(): any {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
  } catch (error) {
    console.error('[createNotification] Error:', error)
  }
}

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
      type:         NotificationTypes.TASK_UPDATED,
      object_type:  'task',
      object_id:    params.taskId,
      object_title: params.taskTitle,
    }))

    await supabase.from('notifications').insert(rows)
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
  NOTE_MENTIONED:        'note_mentioned',        // al mencionado: te nombraron en un comentario de nota
  TASK_UPDATED:          'task_updated',          // al seguidor: se actualizo una tarea que sigues
} as const

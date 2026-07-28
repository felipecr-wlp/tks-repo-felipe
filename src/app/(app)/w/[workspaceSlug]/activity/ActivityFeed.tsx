'use client'

/**
 * ActivityFeed, bitacora (audit log) del workspace.
 *
 * Lee la ruta /api/workspaces/[workspaceId]/activity paginada (limit/offset) y
 * pinta cada evento como una linea legible en español: actor + frase del verbo +
 * objeto (+ proyecto). El primer lote llega ya renderizado por el server para que
 * no haya parpadeo; "Cargar mas" trae el siguiente offset.
 *
 * El diccionario VERB_PHRASES traduce los ~40 verbos de ActivityVerbs
 * (src/lib/activity.ts) a frases con acentos correctos. Cualquier verbo nuevo cae
 * al fallback legible (se sustituyen puntos/guiones bajos por espacios).
 */
import { useCallback, useState } from 'react'
import Image from 'next/image'
import { timeAgo, getInitials } from '@/lib/utils'
import { Activity, Loader2 } from 'lucide-react'
import { useI18n } from '@/lib/i18n/LanguageProvider'
import type { WorkspaceActivityEvent } from '@/app/api/workspaces/[workspaceId]/activity/route'

// ── Traduccion de verbos a frases ────────────────────────────────────────────
// Cada frase encaja despues del nombre del actor: "Ana creó la tarea …".
const VERB_PHRASES_ES: Record<string, string> = {
  // Tareas
  'task.created':         'creó la tarea',
  'task.updated':         'actualizó la tarea',
  'task.deleted':         'eliminó la tarea',
  'task.archived':        'archivó la tarea',
  'task.status_changed':  'cambió el estado de la tarea',
  'task.assigned':        'asignó la tarea',
  'task.unassigned':      'quitó la asignación de la tarea',
  'task.priority_set':    'cambió la prioridad de la tarea',
  'task.due_set':         'fijó la fecha límite de la tarea',
  'task.mentioned':       'te mencionó en la tarea',
  // Comentarios
  'comment.added':        'comentó en',
  'comment.updated':      'editó un comentario en',
  // Proyectos
  'project.created':        'creó el proyecto',
  'project.archived':       'archivó el proyecto',
  'project.member_added':   'agregó un miembro al proyecto',
  'project.proposed':       'propuso el proyecto',
  'project.approved':       'aprobó el proyecto',
  'project.rejected':       'rechazó el proyecto',
  'project.completed':      'completó el proyecto',
  'project.charter_updated':'actualizó el acta del proyecto',
  'project.opened':         'abrió el proyecto',
  'project.closed':         'cerró el proyecto',
  // Postulaciones y reviews
  'application.submitted':  'se postuló a',
  'application.accepted':   'aceptó una postulación en',
  'application.rejected':   'rechazó una postulación en',
  'application.withdrawn':  'retiró su postulación de',
  'review.submitted':       'envió una evaluación en',
  // Notas
  'note.created':         'creó la nota',
  'note.updated':         'actualizó la nota',
  'note.commented':       'comentó en la nota',
  'note.mentioned':       'te mencionó en la nota',
  // Pizarras
  'whiteboard.created':   'creó la pizarra',
  'whiteboard.updated':   'actualizó la pizarra',
  // Workspace
  'workspace.invite_created': 'creó una invitación al espacio',
  'workspace.invite_revoked': 'revocó una invitación al espacio',
  'workspace.member_joined':  'se unió al espacio',
}

const VERB_PHRASES_EN: Record<string, string> = {
  // Tasks
  'task.created':         'created task',
  'task.updated':         'updated task',
  'task.deleted':         'deleted task',
  'task.archived':        'archived task',
  'task.status_changed':  'changed the status of task',
  'task.assigned':        'assigned task',
  'task.unassigned':      'unassigned task',
  'task.priority_set':    'changed the priority of task',
  'task.due_set':         'set the due date of task',
  'task.mentioned':       'mentioned you in task',
  // Comments
  'comment.added':        'commented on',
  'comment.updated':      'edited a comment on',
  // Projects
  'project.created':        'created project',
  'project.archived':       'archived project',
  'project.member_added':   'added a member to project',
  'project.proposed':       'proposed project',
  'project.approved':       'approved project',
  'project.rejected':       'rejected project',
  'project.completed':      'completed project',
  'project.charter_updated':'updated the charter of project',
  'project.opened':         'opened project',
  'project.closed':         'closed project',
  // Applications and reviews
  'application.submitted':  'applied to',
  'application.accepted':   'accepted an application in',
  'application.rejected':   'rejected an application in',
  'application.withdrawn':  'withdrew their application from',
  'review.submitted':       'submitted a review in',
  // Notes
  'note.created':         'created note',
  'note.updated':         'updated note',
  'note.commented':       'commented on note',
  'note.mentioned':       'mentioned you in note',
  // Whiteboards
  'whiteboard.created':   'created whiteboard',
  'whiteboard.updated':   'updated whiteboard',
  // Workspace
  'workspace.invite_created': 'created a workspace invite',
  'workspace.invite_revoked': 'revoked a workspace invite',
  'workspace.member_joined':  'joined the workspace',
}

function verbPhrase(verb: string, lang: string): string {
  const dict = lang === 'en' ? VERB_PHRASES_EN : VERB_PHRASES_ES
  const known = dict[verb]
  if (known) return known
  // Fallback legible: "some.new_verb" -> "some new verb".
  return verb.replace(/[._]/g, ' ')
}

// ── Fila de un evento ────────────────────────────────────────────────────────
function EventRow({ event }: { event: WorkspaceActivityEvent }) {
  const { t, lang } = useI18n()
  const name = event.subject?.display_name ?? t('act.user')
  const avatar = event.subject?.avatar_url ?? null

  return (
    <div className="flex items-start gap-3 py-3 border-b border-border/50 last:border-0">
      <div className="flex-shrink-0 w-7 h-7 rounded-full overflow-hidden bg-muted flex items-center justify-center text-[11px] font-medium text-muted-foreground">
        {avatar ? (
          <Image
            src={avatar}
            alt={name}
            width={28}
            height={28}
            className="w-full h-full object-cover"
          />
        ) : (
          getInitials(name)
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground leading-snug">
          <span className="font-medium">{name}</span>{' '}
          <span className="text-muted-foreground">{verbPhrase(event.verb, lang)}</span>
          {event.object_title ? (
            <>
              {' '}
              <span className="text-foreground">{event.object_title}</span>
            </>
          ) : null}
          {event.project ? (
            <span className="text-muted-foreground">
              {' '}{t('act.inConnector')}{' '}
              <span className="text-foreground">{event.project.name}</span>
            </span>
          ) : null}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          {timeAgo(event.created_at)}
        </p>
      </div>
    </div>
  )
}

export function ActivityFeed({
  workspaceId,
  initialEvents,
  initialNextOffset,
  pageSize,
}: {
  workspaceId: string
  initialEvents: WorkspaceActivityEvent[]
  initialNextOffset: number | null
  pageSize: number
}) {
  const { t } = useI18n()
  const [events, setEvents] = useState<WorkspaceActivityEvent[]>(initialEvents)
  const [nextOffset, setNextOffset] = useState<number | null>(initialNextOffset)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadMore = useCallback(async () => {
    if (nextOffset == null || loading) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/activity?limit=${pageSize}&offset=${nextOffset}`,
      )
      if (!res.ok) throw new Error('fetch')
      const data = (await res.json()) as {
        events: WorkspaceActivityEvent[]
        nextOffset: number | null
      }
      setEvents((prev) => [...prev, ...data.events])
      setNextOffset(data.nextOffset)
    } catch {
      setError(t('act.loadError'))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, nextOffset, pageSize, loading, t])

  if (events.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl px-4 py-12 text-center">
        <Activity className="w-6 h-6 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t('act.empty')}
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="bg-card border border-border rounded-xl px-4 py-1 shadow-soft">
        {events.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>

      {error ? (
        <p className="mt-3 text-xs text-red-600 text-center">{error}</p>
      ) : null}

      {nextOffset != null ? (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            {loading ? t('act.loading') : t('act.loadMore')}
          </button>
        </div>
      ) : null}
    </div>
  )
}

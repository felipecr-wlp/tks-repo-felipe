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
import type { WorkspaceActivityEvent } from '@/app/api/workspaces/[workspaceId]/activity/route'

// ── Traduccion de verbos a frases en español ─────────────────────────────────
// Cada frase encaja despues del nombre del actor: "Ana creó la tarea …".
const VERB_PHRASES: Record<string, string> = {
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

function verbPhrase(verb: string): string {
  const known = VERB_PHRASES[verb]
  if (known) return known
  // Fallback legible: "some.new_verb" -> "some new verb".
  return verb.replace(/[._]/g, ' ')
}

// ── Fila de un evento ────────────────────────────────────────────────────────
function EventRow({ event }: { event: WorkspaceActivityEvent }) {
  const name = event.subject?.display_name ?? 'Usuario'
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
          <span className="text-muted-foreground">{verbPhrase(event.verb)}</span>
          {event.object_title ? (
            <>
              {' '}
              <span className="text-foreground">{event.object_title}</span>
            </>
          ) : null}
          {event.project ? (
            <span className="text-muted-foreground">
              {' '}en{' '}
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
      setError('No se pudo cargar más actividad. Intenta de nuevo.')
    } finally {
      setLoading(false)
    }
  }, [workspaceId, nextOffset, pageSize, loading])

  if (events.length === 0) {
    return (
      <div className="bg-card border border-border rounded-xl px-4 py-12 text-center">
        <Activity className="w-6 h-6 mx-auto mb-3 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Aún no hay actividad registrada en este espacio.
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
            {loading ? 'Cargando…' : 'Cargar más'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

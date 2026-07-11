'use client'

/**
 * Historial de actividad de una tarea. Circuito B12.
 *
 * Feed compacto de "quien hizo que y cuando" leido de activity_events via
 * /api/tasks/[taskId]/activity. Es el complemento VISIBLE de las notificaciones
 * de seguidores (B10/B11): el seguidor recibe el aviso en su bandeja y aqui, en
 * el panel, ve exactamente que cambio. Autocontenido por taskId; se recarga
 * cuando el padre pasa una nueva `refreshKey` (p.ej. tras guardar un campo o
 * comentar), sin acoplarse al estado del panel.
 */
import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { History } from 'lucide-react'
import { cn, getInitials, timeAgo } from '@/lib/utils'

interface Subject { id: string; display_name: string; avatar_url: string | null }
interface ActivityEvent {
  id: string
  verb: string
  created_at: string
  metadata: Record<string, unknown> | null
  subject: Subject | null
}

interface TaskActivitySectionProps {
  taskId: string
  refreshKey?: number
}

// Etiqueta base por verbo. Para task.updated se afina segun el metadata (abajo).
const VERB_LABELS: Record<string, string> = {
  'task.created':         'creó la tarea',
  'task.updated':         'actualizó la tarea',
  'task.deleted':         'archivó la tarea',
  'task.archived':        'archivó la tarea',
  'task.status_changed':  'cambió el estado',
  'task.assigned':        'asignó la tarea',
  'task.unassigned':      'quitó un asignado',
  'task.priority_set':    'cambió la prioridad',
  'task.due_set':         'cambió la fecha de vencimiento',
  'comment.added':        'comentó',
  'task.mentioned':       'mencionó a alguien',
}

// Campos del PATCH -> frase legible. task.updated registra metadata = parsed.data
// (el objeto del patch), asi que sabemos exactamente que se toco.
const FIELD_LABELS: Record<string, string> = {
  title:            'el título',
  description:      'la descripción',
  status_id:        'el estado',
  priority:         'la prioridad',
  assignee_id:      'el asignado',
  due_date:         'la fecha de vencimiento',
  start_date:       'la fecha de inicio',
  estimate_minutes: 'la estimación',
  sprint_id:        'el sprint',
  story_points:     'los story points',
  story_points_done:'los story points hechos',
  area:             'el área',
}

function describe(event: ActivityEvent): string {
  if (event.verb === 'task.updated' && event.metadata) {
    const keys = Object.keys(event.metadata).filter(k => FIELD_LABELS[k])
    if (keys.length === 1) return `cambió ${FIELD_LABELS[keys[0]]}`
    if (keys.length === 2) return `cambió ${FIELD_LABELS[keys[0]]} y ${FIELD_LABELS[keys[1]]}`
    if (keys.length > 2) return `actualizó ${keys.length} campos`
  }
  return VERB_LABELS[event.verb] ?? event.verb
}

export function TaskActivitySection({ taskId, refreshKey }: TaskActivitySectionProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/activity`)
      if (res.ok) {
        const data = await res.json()
        setEvents(data.events ?? [])
      }
    } catch {
      /* silencioso: el historial nunca debe romper el panel */
    } finally {
      setLoaded(true)
    }
  }, [taskId])

  useEffect(() => { load() }, [load, refreshKey])

  if (!loaded || events.length === 0) return null

  return (
    <section>
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-3">
        <History className="w-3.5 h-3.5" />
        Actividad ({events.length})
      </div>

      <ol className="relative space-y-3 pl-1">
        {events.map((event, i) => (
          <li key={event.id} className="flex items-start gap-2.5">
            {/* Avatar + linea de tiempo */}
            <div className="relative flex-shrink-0">
              <span className="block w-5 h-5 rounded-full overflow-hidden bg-muted ring-2 ring-background">
                {event.subject?.avatar_url ? (
                  <Image
                    src={event.subject.avatar_url}
                    alt={event.subject.display_name}
                    width={20}
                    height={20}
                    className="object-cover"
                  />
                ) : (
                  <span className="flex items-center justify-center w-full h-full text-[8px] font-medium text-muted-foreground">
                    {getInitials(event.subject?.display_name ?? '?')}
                  </span>
                )}
              </span>
              {i < events.length - 1 && (
                <span className="absolute left-1/2 top-5 -translate-x-1/2 w-px h-[calc(100%+0.25rem)] bg-border" />
              )}
            </div>

            {/* Texto */}
            <div className="flex-1 min-w-0 pb-0.5">
              <p className={cn('text-xs leading-snug text-muted-foreground')}>
                <span className="font-medium text-foreground">
                  {event.subject?.display_name ?? 'Alguien'}
                </span>{' '}
                {describe(event)}
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                {timeAgo(event.created_at)}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

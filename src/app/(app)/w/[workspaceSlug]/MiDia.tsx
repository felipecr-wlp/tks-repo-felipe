'use client'

/**
 * MiDia, agenda de HOY para la home. Prioriza lo de WLO sobre Google.
 *
 * Dos fuentes independientes:
 *  - WLO (/api/activities): tareas asignadas con vencimiento hoy + fin de sprint.
 *    Se muestran ARRIBA con acento primario. Utiles aunque Google no este conectado.
 *  - Google (/api/calendar/events): agenda externa, en tono atenuado abajo. Si no
 *    hay conexion se ofrece un CTA discreto, sin bloquear el resto del panel.
 *
 * Los tokens de Google nunca se manejan en el cliente (todo via el endpoint).
 */
import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import {
  CalendarDays,
  CheckSquare,
  ExternalLink,
  Loader2,
  Timer,
} from 'lucide-react'

type CalEvent = {
  id: string
  title: string
  start: string | null
  end: string | null
  allDay: boolean
  htmlLink: string | null
}

type WloActivity = {
  id: string
  type: 'task' | 'sprint'
  title: string
  date: string
  priority: string | null
  project_name: string | null
  href: string
}

type WloState =
  | { kind: 'loading' }
  | { kind: 'ok'; activities: WloActivity[] }
  | { kind: 'error' }

type GoogleState =
  | { kind: 'loading' }
  | { kind: 'ok'; events: CalEvent[] }
  | { kind: 'not_connected' }
  | { kind: 'reconnect' }
  | { kind: 'error' }

interface MiDiaProps {
  calendarPath: string
}

const PRIORITY_DOT: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-blue-500',
  none: 'bg-muted-foreground/40',
}

export default function MiDia({ calendarPath }: MiDiaProps) {
  const [wlo, setWlo] = useState<WloState>({ kind: 'loading' })
  const [google, setGoogle] = useState<GoogleState>({ kind: 'loading' })

  const { from, to } = useMemo(() => {
    const now = new Date()
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0)
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)
    return { from: start.toISOString(), to: end.toISOString() }
  }, [])

  useEffect(() => {
    let alive = true
    const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`

    ;(async () => {
      try {
        const res = await fetch(`/api/activities?${qs}`)
        if (!alive) return
        if (!res.ok) { setWlo({ kind: 'error' }); return }
        const body = await res.json()
        setWlo({ kind: 'ok', activities: (body.activities ?? []) as WloActivity[] })
      } catch {
        if (alive) setWlo({ kind: 'error' })
      }
    })()

    ;(async () => {
      try {
        const res = await fetch(`/api/calendar/events?${qs}`)
        if (!alive) return
        if (res.status === 409) {
          const body = await res.json().catch(() => ({}))
          setGoogle({ kind: body?.reason === 'reconnect' ? 'reconnect' : 'not_connected' })
          return
        }
        if (!res.ok) { setGoogle({ kind: 'error' }); return }
        const body = await res.json()
        setGoogle({ kind: 'ok', events: (body.events ?? []) as CalEvent[] })
      } catch {
        if (alive) setGoogle({ kind: 'error' })
      }
    })()

    return () => { alive = false }
  }, [from, to])

  const connectUrl = `/api/google/connect?next=${encodeURIComponent(calendarPath)}`

  const wloItems = wlo.kind === 'ok' ? wlo.activities : []
  const googleItems = google.kind === 'ok' ? google.events : []
  const loading = wlo.kind === 'loading' && google.kind === 'loading'
  const bothEmpty =
    wlo.kind !== 'loading' && wloItems.length === 0 &&
    google.kind === 'ok' && googleItems.length === 0

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Mi día
        </h2>
        <a
          href={calendarPath}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Ver calendario
        </a>
      </div>

      <div className="bg-card border border-border rounded-xl p-3 min-h-[120px]">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && (
          <div className="space-y-4">
            {/* WLO primero */}
            <div>
              <p className="px-1 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary/80">
                Tareas de hoy
              </p>
              {wlo.kind === 'error' && (
                <p className="text-sm text-muted-foreground px-2 py-3">
                  No se pudieron cargar tus tareas.
                </p>
              )}
              {wlo.kind === 'ok' && wloItems.length === 0 && (
                <p className="text-sm text-muted-foreground px-2 py-3">
                  Nada de WLO vence hoy.
                </p>
              )}
              {wloItems.length > 0 && (
                <ul className="space-y-0.5">
                  {wloItems.map((a) => (
                    <li key={`${a.type}-${a.id}`}>
                      <a
                        href={a.href || '#'}
                        className="group flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-accent transition-colors"
                      >
                        <span className="flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md bg-primary/10 text-primary">
                          {a.type === 'sprint'
                            ? <Timer size={13} />
                            : <CheckSquare size={13} />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-foreground truncate group-hover:text-primary transition-colors">
                            {a.title}
                          </span>
                          {(a.project_name || a.type === 'sprint') && (
                            <span className="block text-[11px] text-muted-foreground truncate">
                              {a.type === 'sprint' ? 'Fin de sprint' : a.project_name}
                            </span>
                          )}
                        </span>
                        {a.type === 'task' && (
                          <span
                            className={`flex-shrink-0 w-2 h-2 rounded-full ${PRIORITY_DOT[a.priority ?? 'none'] ?? PRIORITY_DOT.none}`}
                            title={`Prioridad: ${a.priority ?? 'ninguna'}`}
                          />
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Google atenuado */}
            <div className="pt-3 border-t border-border/60">
              <div className="flex items-center justify-between px-1 mb-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Agenda externa
                </p>
                {(google.kind === 'not_connected' || google.kind === 'reconnect') && (
                  <a href={connectUrl} className="text-[11px] text-primary hover:underline">
                    {google.kind === 'reconnect' ? 'Reconectar Google' : 'Conectar Google'}
                  </a>
                )}
              </div>

              {(google.kind === 'not_connected' || google.kind === 'reconnect') && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground px-2 py-2">
                  <CalendarDays size={13} className="flex-shrink-0" />
                  {google.kind === 'reconnect'
                    ? 'La conexión con Google expiró.'
                    : 'Conecta Google Calendar para ver tu agenda externa.'}
                </p>
              )}
              {google.kind === 'error' && (
                <p className="text-xs text-muted-foreground px-2 py-2">
                  No se pudo cargar Google Calendar.
                </p>
              )}
              {google.kind === 'ok' && googleItems.length === 0 && (
                <p className="text-xs text-muted-foreground px-2 py-2">
                  Sin eventos externos hoy.
                </p>
              )}
              {googleItems.length > 0 && (
                <ul className="space-y-0.5">
                  {googleItems.map((ev) => (
                    <li key={ev.id}>
                      <a
                        href={ev.htmlLink ?? '#'}
                        target={ev.htmlLink ? '_blank' : undefined}
                        rel="noopener noreferrer"
                        className="group flex items-center gap-3 rounded-lg px-2.5 py-1.5 hover:bg-accent transition-colors"
                      >
                        <span className="flex-shrink-0 w-14 text-[11px] tabular-nums text-muted-foreground">
                          {ev.allDay ? 'Todo' : ev.start ? format(new Date(ev.start), 'HH:mm') : ''}
                        </span>
                        <span className="flex-1 min-w-0 text-sm text-muted-foreground truncate group-hover:text-foreground transition-colors">
                          {ev.title}
                        </span>
                        {ev.htmlLink && (
                          <ExternalLink size={12} className="flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {bothEmpty && (
              <p className="text-center text-xs text-muted-foreground pt-1">
                Día despejado.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  )
}

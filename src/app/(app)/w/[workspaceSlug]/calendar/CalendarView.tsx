'use client'

/**
 * CalendarView — vista mensual propia (grilla con date-fns) que fusiona DOS
 * fuentes:
 *  - Actividades WLO (/api/activities): tareas con vencimiento + fin de sprint.
 *  - Eventos de Google (/api/calendar/events): agenda externa.
 *
 * Las fuentes se distinguen por color/badge. Filtros de cliente minimalistas
 * (WLO on/off, Google on/off, ocultar eventos de todo el dia, buscar por titulo)
 * persistidos en localStorage `wlo-calendar-filters`. Google en tono atenuado
 * para bajar el ruido; WLO con acento primario.
 *
 * Si Google no esta conectado la vista NO se bloquea: sigue mostrando WLO y
 * ofrece un CTA discreto para conectar.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { es } from 'date-fns/locale'
import {
  CalendarDays,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Loader2,
  RefreshCw,
  Search,
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

type CalItem = {
  key: string
  source: 'wlo' | 'google'
  kind: 'task' | 'sprint' | 'event'
  title: string
  start: string
  end: string | null
  allDay: boolean
  href: string | null
  external: boolean
  subtitle: string | null
}

type GoogleState = 'loading' | 'ok' | 'not_connected' | 'reconnect' | 'error'
type WloState = 'loading' | 'ok' | 'error'

type Filters = {
  showWlo: boolean
  showGoogle: boolean
  hideAllDay: boolean
  query: string
}

interface CalendarViewProps {
  basePath: string
  initiallyConnected: boolean
  connectedEmail: string | null
}

const WEEKDAYS = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
const FILTERS_KEY = 'wlo-calendar-filters'
const DEFAULT_FILTERS: Filters = {
  showWlo: true,
  showGoogle: true,
  hideAllDay: false,
  query: '',
}

export default function CalendarView({
  basePath,
  initiallyConnected,
  connectedEmail,
}: CalendarViewProps) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState(() => new Date())

  const [googleState, setGoogleState] = useState<GoogleState>(
    initiallyConnected ? 'loading' : 'not_connected',
  )
  const [wloState, setWloState] = useState<WloState>('loading')
  const [googleEvents, setGoogleEvents] = useState<CalEvent[]>([])
  const [wloActivities, setWloActivities] = useState<WloActivity[]>([])

  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)

  // Cargar filtros persistidos (solo cliente).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(FILTERS_KEY)
      if (raw) setFilters({ ...DEFAULT_FILTERS, ...JSON.parse(raw) })
    } catch { /* noop */ }
  }, [])

  const patchFilters = useCallback((patch: Partial<Filters>) => {
    setFilters((prev) => {
      const next = { ...prev, ...patch }
      try { window.localStorage.setItem(FILTERS_KEY, JSON.stringify(next)) } catch { /* noop */ }
      return next
    })
  }, [])

  // Rango de la grilla (semana completa antes y despues del mes).
  const gridStart = useMemo(
    () => startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }),
    [cursor],
  )
  const gridEnd = useMemo(
    () => endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }),
    [cursor],
  )
  const days = useMemo(
    () => eachDayOfInterval({ start: gridStart, end: gridEnd }),
    [gridStart, gridEnd],
  )

  const load = useCallback(async () => {
    const from = gridStart.toISOString()
    const to = gridEnd.toISOString()
    const qs = `from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`

    // WLO (siempre disponible; no depende de Google).
    setWloState('loading')
    void (async () => {
      try {
        const res = await fetch(`/api/activities?${qs}`)
        if (!res.ok) { setWloState('error'); return }
        const body = await res.json()
        setWloActivities((body.activities ?? []) as WloActivity[])
        setWloState('ok')
      } catch { setWloState('error') }
    })()

    // Google (solo si hay conexion).
    if (!initiallyConnected) {
      setGoogleState('not_connected')
      return
    }
    setGoogleState('loading')
    try {
      const res = await fetch(`/api/calendar/events?${qs}`)
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}))
        setGoogleState(body?.reason === 'reconnect' ? 'reconnect' : 'not_connected')
        return
      }
      if (!res.ok) { setGoogleState('error'); return }
      const body = await res.json()
      setGoogleEvents((body.events ?? []) as CalEvent[])
      setGoogleState('ok')
    } catch {
      setGoogleState('error')
    }
  }, [gridStart, gridEnd, initiallyConnected])

  useEffect(() => {
    void load()
  }, [load])

  const connectUrl = `/api/google/connect?next=${encodeURIComponent(basePath)}`

  // Fusion + filtros de cliente.
  const items = useMemo<CalItem[]>(() => {
    const out: CalItem[] = []
    const q = filters.query.trim().toLowerCase()

    if (filters.showWlo) {
      for (const a of wloActivities) {
        if (q && !a.title.toLowerCase().includes(q)) continue
        out.push({
          key: `wlo-${a.type}-${a.id}`,
          source: 'wlo',
          kind: a.type,
          title: a.title,
          start: a.date,
          end: null,
          allDay: a.type === 'sprint',
          href: a.href || null,
          external: false,
          subtitle: a.type === 'sprint' ? 'Fin de sprint' : a.project_name,
        })
      }
    }

    if (filters.showGoogle) {
      for (const ev of googleEvents) {
        if (!ev.start) continue
        if (filters.hideAllDay && ev.allDay) continue
        if (q && !ev.title.toLowerCase().includes(q)) continue
        out.push({
          key: `google-${ev.id}`,
          source: 'google',
          kind: 'event',
          title: ev.title,
          start: ev.start,
          end: ev.end,
          allDay: ev.allDay,
          href: ev.htmlLink,
          external: true,
          subtitle: null,
        })
      }
    }

    return out
  }, [filters, wloActivities, googleEvents])

  const itemsByDay = useMemo(() => {
    const map = new Map<string, CalItem[]>()
    for (const it of items) {
      const d = it.allDay ? parseISO(it.start) : new Date(it.start)
      const key = format(d, 'yyyy-MM-dd')
      const arr = map.get(key) ?? []
      arr.push(it)
      map.set(key, arr)
    }
    // Orden dentro del dia: WLO primero, luego por hora.
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        if (a.source !== b.source) return a.source === 'wlo' ? -1 : 1
        return new Date(a.start).getTime() - new Date(b.start).getTime()
      })
    }
    return map
  }, [items])

  const selectedItems = itemsByDay.get(format(selected, 'yyyy-MM-dd')) ?? []
  const initialLoading = wloState === 'loading' && googleState === 'loading'

  const chipClass = (it: CalItem) =>
    it.source === 'wlo'
      ? it.kind === 'sprint'
        ? 'bg-violet-500/10 text-violet-600 dark:text-violet-400'
        : 'bg-primary/10 text-primary'
      : 'bg-muted text-muted-foreground'

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
            <CalendarDays size={20} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-foreground tracking-tight">
              Calendario
            </h1>
            {connectedEmail && googleState === 'ok' && (
              <p className="text-xs text-muted-foreground mt-0.5">
                Google conectado como {connectedEmail}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => { setCursor(startOfMonth(new Date())); setSelected(new Date()) }}
            className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-accent transition-colors"
          >
            Hoy
          </button>
          <div className="flex items-center border border-border rounded-lg overflow-hidden">
            <button
              onClick={() => setCursor((c) => addMonths(c, -1))}
              aria-label="Mes anterior"
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <ChevronLeft size={18} />
            </button>
            <button
              onClick={() => setCursor((c) => addMonths(c, 1))}
              aria-label="Mes siguiente"
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors border-l border-border"
            >
              <ChevronRight size={18} />
            </button>
          </div>
          <button
            onClick={() => void load()}
            aria-label="Recargar"
            className="p-1.5 text-muted-foreground hover:text-foreground border border-border rounded-lg hover:bg-accent transition-colors"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Barra de filtros */}
      <div className="mb-5 flex items-center gap-2 flex-wrap">
        <FilterToggle
          active={filters.showWlo}
          onClick={() => patchFilters({ showWlo: !filters.showWlo })}
          accent="primary"
          icon={<CheckSquare size={13} />}
          label="Actividades WLO"
        />
        <FilterToggle
          active={filters.showGoogle}
          onClick={() => patchFilters({ showGoogle: !filters.showGoogle })}
          accent="muted"
          icon={<CalendarDays size={13} />}
          label="Eventos Google"
        />
        <FilterToggle
          active={filters.hideAllDay}
          onClick={() => patchFilters({ hideAllDay: !filters.hideAllDay })}
          accent="muted"
          label="Ocultar todo el día"
        />
        <div className="relative ml-auto">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            value={filters.query}
            onChange={(e) => patchFilters({ query: e.target.value })}
            placeholder="Buscar por título"
            className="w-48 pl-8 pr-3 py-1.5 text-sm bg-card border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

      {/* CTA discreto de Google (no bloquea la grilla) */}
      {(googleState === 'not_connected' || googleState === 'reconnect') && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarDays size={15} className="flex-shrink-0" />
            {googleState === 'reconnect'
              ? 'La conexión con Google expiró o fue revocada. Reconecta para ver tu agenda externa.'
              : 'Conecta Google Calendar para sumar tu agenda externa (solo lectura).'}
          </p>
          <a
            href={connectUrl}
            className="flex-shrink-0 inline-flex items-center gap-2 px-3.5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            <CalendarDays size={15} />
            {googleState === 'reconnect' ? 'Reconectar' : 'Conectar Google'}
          </a>
        </div>
      )}

      {googleState === 'error' && (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3">
          <p className="text-sm text-foreground">No se pudo cargar Google Calendar.</p>
          <button
            onClick={() => void load()}
            className="inline-flex items-center gap-2 px-3 py-1.5 border border-border text-sm rounded-lg hover:bg-accent transition-colors"
          >
            <RefreshCw size={14} /> Reintentar
          </button>
        </div>
      )}

      {/* Cargando inicial */}
      {initialLoading ? (
        <div className="rounded-2xl border border-border bg-card p-16 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Grilla — 2 cols */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-foreground capitalize">
                {format(cursor, 'LLLL yyyy', { locale: es })}
              </h2>
            </div>

            <div className="grid grid-cols-7 gap-px bg-border rounded-xl overflow-hidden border border-border">
              {WEEKDAYS.map((w) => (
                <div key={w} className="bg-muted/40 px-2 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  {w}
                </div>
              ))}

              {days.map((day) => {
                const key = format(day, 'yyyy-MM-dd')
                const dayItems = itemsByDay.get(key) ?? []
                const inMonth = isSameMonth(day, cursor)
                const active = isSameDay(day, selected)
                return (
                  <button
                    key={key}
                    onClick={() => setSelected(day)}
                    className={[
                      'min-h-[92px] bg-card p-1.5 text-left align-top transition-colors',
                      inMonth ? '' : 'bg-muted/20',
                      active ? 'ring-2 ring-inset ring-primary' : 'hover:bg-accent/50',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'inline-flex items-center justify-center w-6 h-6 rounded-full text-xs mb-1',
                        isToday(day) ? 'bg-primary text-primary-foreground font-semibold' : '',
                        inMonth ? 'text-foreground' : 'text-muted-foreground',
                      ].join(' ')}
                    >
                      {format(day, 'd')}
                    </span>
                    <div className="space-y-0.5">
                      {dayItems.slice(0, 3).map((it) => (
                        <div
                          key={it.key}
                          className={`truncate rounded px-1 py-0.5 text-[10px] leading-tight ${chipClass(it)}`}
                          title={it.title}
                        >
                          {it.source === 'google' && !it.allDay && it.start && (
                            <span className="opacity-70 mr-0.5">
                              {format(new Date(it.start), 'HH:mm')}
                            </span>
                          )}
                          {it.title}
                        </div>
                      ))}
                      {dayItems.length > 3 && (
                        <div className="px-1 text-[10px] text-muted-foreground">
                          +{dayItems.length - 3} mas
                        </div>
                      )}
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Panel del dia — 1 col */}
          <div className="lg:col-span-1">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium text-foreground capitalize">
                {format(selected, "EEEE d 'de' LLLL", { locale: es })}
              </h2>
            </div>
            <div className="bg-card border border-border rounded-xl p-2 min-h-[200px]">
              {selectedItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-10">
                  Sin actividades este día
                </p>
              ) : (
                <ul className="space-y-1">
                  {selectedItems.map((it) => {
                    const content = (
                      <>
                        <span className={`mt-0.5 flex-shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-md ${chipClass(it)}`}>
                          {it.kind === 'sprint'
                            ? <Timer size={13} />
                            : it.kind === 'task'
                              ? <CheckSquare size={13} />
                              : <CalendarDays size={13} />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className={`block text-sm truncate transition-colors ${it.source === 'wlo' ? 'text-foreground group-hover:text-primary' : 'text-muted-foreground group-hover:text-foreground'}`}>
                            {it.title}
                          </span>
                          <span className="block text-[11px] text-muted-foreground mt-0.5 truncate">
                            {it.subtitle
                              ? it.subtitle
                              : it.allDay
                                ? 'Todo el día'
                                : it.start
                                  ? `${format(new Date(it.start), 'HH:mm')}${it.end ? ` - ${format(new Date(it.end), 'HH:mm')}` : ''}`
                                  : ''}
                          </span>
                        </span>
                        {it.external && it.href && (
                          <ExternalLink size={13} className="mt-1 flex-shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        )}
                      </>
                    )
                    return (
                      <li key={it.key}>
                        {it.href ? (
                          <a
                            href={it.href}
                            target={it.external ? '_blank' : undefined}
                            rel={it.external ? 'noopener noreferrer' : undefined}
                            className="group flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-accent transition-colors"
                          >
                            {content}
                          </a>
                        ) : (
                          <div className="group flex items-start gap-2.5 rounded-lg px-2.5 py-2">
                            {content}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FilterToggle({
  active,
  onClick,
  label,
  icon,
  accent,
}: {
  active: boolean
  onClick: () => void
  label: string
  icon?: React.ReactNode
  accent: 'primary' | 'muted'
}) {
  const activeCls = accent === 'primary'
    ? 'bg-primary/10 text-primary border-primary/30'
    : 'bg-accent text-foreground border-border'
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={[
        'inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors',
        active ? activeCls : 'bg-card text-muted-foreground border-border hover:text-foreground',
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}

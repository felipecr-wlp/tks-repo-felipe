'use client'

/**
 * Vista de calendario mensual de tareas (Gantt ligero).
 *
 * Coloca cada tarea segun su rango [start_date, due_date] como una barra que se
 * extiende sobre los dias de la semana. Una tarea con solo due_date es una barra
 * de un dia. Las barras se apilan en carriles cuando se traslapan. Al hacer clic
 * en una barra se abre el TaskDetailPanel (misma UX que la lista).
 *
 * Sin dependencias de fecha externas: la aritmetica de dias se hace con Date en
 * hora local para respetar la zona del usuario.
 *
 * ARRASTRE (v6). Reprogramar exigia abrir la tarea, buscar el campo y teclear la
 * fecha: tres pasos para algo que en un calendario es un gesto. Ahora la barra se
 * arrastra a otro dia y las fechas se mandan solas.
 *
 * A diferencia del Gantt, aqui NO se cuentan pixeles: la rejilla parte en filas
 * de siete y un arrastre puede saltar de renglon, asi que se pregunta por el DIA
 * QUE ESTA DEBAJO DEL PUNTERO. Los rectangulos de las celdas se congelan al
 * empezar el arrastre; medirlos en cada movimiento obliga al navegador a
 * recalcular el layout cuarenta veces por segundo y el arrastre se siente pegado.
 *
 * Regla de forma: NO se inventan fechas. Si una tarea solo tenia vencimiento, al
 * moverla solo cambia el vencimiento; el inicio nace unicamente si alguien jala
 * el extremo izquierdo a proposito.
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, CalendarDays, CheckCircle2, AlertTriangle, CalendarClock } from 'lucide-react'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { TaskDetailPanel } from './TaskDetailPanel'
import { useI18n } from '@/lib/i18n/LanguageProvider'

interface Status { id: string; name: string; color: string | null; category: string; position: number }
interface Member { id: string; display_name: string; avatar_url: string | null }
interface Task {
  id: string
  title: string
  priority: string
  due_date: string | null
  start_date: string | null
  sort_order: string
  status: { id: string; name: string; color: string | null; category: string } | null
  assignee: { id: string; display_name: string; avatar_url: string | null } | null
  labels?: { id: string; name: string; color: string }[]
}

interface TaskCalendarViewProps {
  projectId: string
  tasks: Task[]
  statuses: Status[]
  members: Member[]
  currentUserId: string
}

const DAY_MS = 86_400_000
const WEEKDAY_KEYS = ['cal.wdMon', 'cal.wdTue', 'cal.wdWed', 'cal.wdThu', 'cal.wdFri', 'cal.wdSat', 'cal.wdSun']
const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ef4444', high: '#f97316', medium: '#eab308', low: '#3b82f6', none: '#94a3b8',
}

// Clasifica el vencimiento relativo a HOY (medianoche local, sin corrimiento por
// zona horaria). Mismo criterio que la lista y el tablero.
type DueBucket = 'overdue' | 'today' | 'future'
function dueBucket(due: string | null | undefined, isDone: boolean): DueBucket | null {
  if (!due || isDone) return null
  const d = new Date(String(due).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  const t = new Date(); t.setHours(0, 0, 0, 0)
  if (d.getTime() < t.getTime()) return 'overdue'
  if (d.getTime() === t.getTime()) return 'today'
  return 'future'
}

/**
 * Mismo criterio que `dueBucket`, pero sobre la fecha que la barra tiene AHORA.
 * Durante un arrastre importa: si alguien mueve una tarea al pasado, tiene que
 * ponerse roja mientras la arrastra, no despues de que el servidor conteste.
 */
function bucketDeFecha(end: Date, isDone: boolean): DueBucket | null {
  if (isDone) return null
  const t = new Date(); t.setHours(0, 0, 0, 0)
  if (end.getTime() < t.getTime()) return 'overdue'
  if (end.getTime() === t.getTime()) return 'today'
  return 'future'
}

function startOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
function addDays(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n) }
function parseDay(iso: string): Date { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
// Indice de columna con la semana empezando en lunes (0 = Lun ... 6 = Dom).
function mondayIndex(d: Date): number { return (d.getDay() + 6) % 7 }
// Se guarda a MEDIODIA local. Guardar a medianoche hace que cualquier conversion
// a UTC caiga en el dia anterior para media America, y la tarea "se mueve sola".
function noonIso(d: Date): string { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0).toISOString() }

interface Bar {
  task: Task
  startCol: number
  endCol: number
  lane: number
  /** Rango REAL de la tarea, no el recortado a la semana: el arrastre lo necesita. */
  start: Date
  end: Date
  /** La barra sigue antes / despues de esta semana (no se dibuja manija ahi). */
  clipStart: boolean
  clipEnd: boolean
}

/** Cuantos pixeles hay que moverse antes de que esto deje de ser un clic. */
const DRAG_THRESHOLD = 4

type DragMode = 'move' | 'start' | 'end'

interface DragSession {
  task: Task
  mode: DragMode
  /** Dia sobre el que se apreto, en epoch. El delta se mide contra este. */
  originMs: number
  origStart: Date
  origEnd: Date
  curStart: Date
  curEnd: Date
  startClientX: number
  startClientY: number
  moved: boolean
  /** Rectangulos de las celdas, congelados al empezar (ver cabecera). */
  celdas: { ms: number; r: DOMRect }[]
}

export function TaskCalendarView({ projectId, tasks, statuses, members, currentUserId }: TaskCalendarViewProps) {
  const router = useRouter()
  const { t: tr, lang } = useI18n()
  const locale = lang === 'en' ? 'en-US' : 'es-MX'
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  // Mes inicial: el actual si tiene tareas con fecha; si no, salta al primer mes
  // proximo con tareas (o al mas reciente hacia atras) para no abrir vacio.
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    const cur = new Date(n.getFullYear(), n.getMonth(), 1)
    const months = tasks
      .map(t => t.start_date || t.due_date)
      .filter((x): x is string => !!x)
      .map(iso => { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), 1) })
    if (months.length === 0) return cur
    if (months.some(m => m.getTime() === cur.getTime())) return cur
    const upcoming = months.filter(m => m.getTime() >= cur.getTime()).sort((a, b) => a.getTime() - b.getTime())
    if (upcoming.length) return upcoming[0]
    return months.sort((a, b) => b.getTime() - a.getTime())[0]
  })

  useRealtimeRefresh({
    channel: `proj-cal-${projectId}`,
    tables: [
      { table: 'tasks',         filter: `project_id=eq.${projectId}` },
      { table: 'task_statuses', filter: `project_id=eq.${projectId}` },
    ],
  })

  const today = startOfDay(new Date())

  // ── Arrastre ───────────────────────────────────────────────────────────────
  // `overrides` pinta el resultado antes de que conteste el servidor: esperar el
  // viaje de red deja la barra clavada en el dia viejo medio segundo y parece
  // que el arrastre no funciono. Si el PATCH falla, se revierte.
  const [overrides, setOverrides] = useState<Record<string, { start: Date | null; end: Date | null }>>({})
  const [drag, setDrag] = useState<{ taskId: string; start: Date; end: Date; moved: boolean } | null>(null)
  const dragSession = useRef<DragSession | null>(null)
  const gridRef = useRef<HTMLDivElement | null>(null)
  // Al llegar tareas nuevas del servidor, el optimismo ya no hace falta.
  useEffect(() => { setOverrides({}) }, [tasks])

  function commitDates(t: Task, start: Date, end: Date) {
    const s = start <= end ? start : end
    const e = start <= end ? end : start
    // No se inventan fechas: solo se manda el campo que la tarea ya tenia, mas
    // el que se acaba de crear a proposito jalando un extremo.
    const rango = s.getTime() !== e.getTime()
    const mandaInicio = t.start_date != null || rango
    const mandaFin = t.due_date != null || rango
    const body: { start_date?: string; due_date?: string } = {}
    if (mandaInicio) body.start_date = noonIso(s)
    if (mandaFin) body.due_date = noonIso(e)

    setOverrides(o => ({ ...o, [t.id]: { start: mandaInicio ? s : null, end: mandaFin ? e : null } }))

    fetch(`/api/tasks/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(res => {
        if (!res.ok) {
          toast.error(res.status === 403 ? tr('toast.moveNoAccess') : tr('toast.moveFailed'))
          setOverrides(o => { const n = { ...o }; delete n[t.id]; return n })
        } else {
          toast.success(tr('toast.dateUpdated'))
          router.refresh()
        }
      })
      .catch(() => {
        toast.error(tr('toast.moveNetwork'))
        setOverrides(o => { const n = { ...o }; delete n[t.id]; return n })
      })
  }

  // Los listeners se montan UNA vez y leen refs. Montarlos por barra los volveria
  // a colgar en cada re-render del arrastre, que es cuando peor cae.
  const helpersRef = useRef({ commitDates, setSelectedTaskId })
  helpersRef.current = { commitDates, setSelectedTaskId }

  useEffect(() => {
    function diaBajoPuntero(sess: DragSession, x: number, y: number): number | null {
      for (const c of sess.celdas) {
        if (x >= c.r.left && x <= c.r.right && y >= c.r.top && y <= c.r.bottom) return c.ms
      }
      return null
    }
    function onMove(e: PointerEvent) {
      const sess = dragSession.current
      if (!sess) return
      if (Math.abs(e.clientX - sess.startClientX) > DRAG_THRESHOLD
        || Math.abs(e.clientY - sess.startClientY) > DRAG_THRESHOLD) sess.moved = true
      const ms = diaBajoPuntero(sess, e.clientX, e.clientY)
      if (ms == null) return // fuera de la rejilla: se conserva lo ultimo valido
      const deltaDias = Math.round((ms - sess.originMs) / DAY_MS)
      let ns = sess.origStart
      let ne = sess.origEnd
      if (sess.mode === 'move') {
        ns = addDays(sess.origStart, deltaDias)
        ne = addDays(sess.origEnd, deltaDias)
      } else if (sess.mode === 'start') {
        ns = addDays(sess.origStart, deltaDias)
        if (ns > sess.origEnd) ns = sess.origEnd
      } else {
        ne = addDays(sess.origEnd, deltaDias)
        if (ne < sess.origStart) ne = sess.origStart
      }
      sess.curStart = ns
      sess.curEnd = ne
      setDrag({ taskId: sess.task.id, start: ns, end: ne, moved: sess.moved })
    }
    function onUp() {
      const sess = dragSession.current
      dragSession.current = null
      if (!sess) { setDrag(null); return }
      const h = helpersRef.current
      if (!sess.moved) {
        // Fue un clic: la barra sigue abriendo la tarea, como siempre.
        h.setSelectedTaskId(sess.task.id)
      } else if (sess.curStart.getTime() !== sess.origStart.getTime()
        || sess.curEnd.getTime() !== sess.origEnd.getTime()) {
        h.commitDates(sess.task, sess.curStart, sess.curEnd)
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  function startDrag(e: React.PointerEvent, task: Task, start: Date, end: Date, mode: DragMode) {
    e.preventDefault()
    e.stopPropagation()
    const celdas: { ms: number; r: DOMRect }[] = []
    const nodos = gridRef.current?.querySelectorAll<HTMLElement>('[data-day]') ?? []
    nodos.forEach(n => {
      const ms = Number(n.dataset.day)
      if (!Number.isNaN(ms)) celdas.push({ ms, r: n.getBoundingClientRect() })
    })
    // El origen es el dia bajo el puntero, no el inicio de la barra: agarrar una
    // barra por la mitad y soltarla debe mover ESE dia, no el primero.
    let originMs = start.getTime()
    for (const c of celdas) {
      if (e.clientX >= c.r.left && e.clientX <= c.r.right && e.clientY >= c.r.top && e.clientY <= c.r.bottom) {
        originMs = c.ms
        break
      }
    }
    if (mode === 'start') originMs = start.getTime()
    if (mode === 'end') originMs = end.getTime()
    dragSession.current = {
      task, mode, originMs, origStart: start, origEnd: end, curStart: start, curEnd: end,
      startClientX: e.clientX, startClientY: e.clientY, moved: false, celdas,
    }
    setDrag({ taskId: task.id, start, end, moved: false })
  }

  // Rango de tarea: [start, end] en dias. Requiere al menos una de las dos fechas.
  // Se aplican primero los overrides (optimismo ya confirmado por el gesto) y
  // encima el arrastre en curso, para que la barra siga al puntero.
  const dated = useMemo(() => tasks.map(t => {
    const ov = overrides[t.id]
    const dueIso = ov ? (ov.end ? ov.end.toISOString() : null) : t.due_date
    const startIso = ov ? (ov.start ? ov.start.toISOString() : null) : t.start_date
    const due = dueIso ? parseDay(dueIso) : null
    const start = startIso ? parseDay(startIso) : null
    if (!due && !start) return null
    const s = start ?? due!
    const e = due ?? start!
    const base = { task: t, start: s <= e ? s : e, end: s <= e ? e : s }
    if (drag && drag.taskId === t.id) return { ...base, start: drag.start, end: drag.end }
    return base
  }).filter((x): x is { task: Task; start: Date; end: Date } => x != null), [tasks, overrides, drag])

  // Rejilla del mes: semanas (filas) empezando en lunes, cubriendo el mes visible.
  const weeks = useMemo(() => {
    const firstOfMonth = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const gridStart = addDays(firstOfMonth, -mondayIndex(firstOfMonth))
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    const numWeeks = Math.ceil((mondayIndex(firstOfMonth) + daysInMonth) / 7)
    const rows: Date[][] = []
    for (let w = 0; w < numWeeks; w++) {
      rows.push(Array.from({ length: 7 }, (_, i) => addDays(gridStart, w * 7 + i)))
    }
    return rows
  }, [cursor])

  // Barras por semana con asignacion de carriles (greedy) para apilar traslapes.
  function barsForWeek(week: Date[]): Bar[] {
    const weekStart = week[0]
    const weekEnd = week[6]
    const intersecting = dated
      .filter(d => d.end >= weekStart && d.start <= weekEnd)
      .sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime())

    const laneEnds: number[] = [] // ultima columna ocupada por carril
    const bars: Bar[] = []
    for (const d of intersecting) {
      const clampedStart = d.start < weekStart ? weekStart : d.start
      const clampedEnd = d.end > weekEnd ? weekEnd : d.end
      const startCol = Math.round((clampedStart.getTime() - weekStart.getTime()) / DAY_MS)
      const endCol = Math.round((clampedEnd.getTime() - weekStart.getTime()) / DAY_MS)
      let lane = laneEnds.findIndex(end => end < startCol)
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(endCol) }
      else laneEnds[lane] = endCol
      bars.push({
        task: d.task, startCol, endCol, lane,
        start: d.start, end: d.end,
        clipStart: d.start < weekStart, clipEnd: d.end > weekEnd,
      })
    }
    return bars
  }

  const monthLabel = cursor.toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const undated = tasks.length - dated.length

  return (
    <div className="px-6 py-4">
      {selectedTaskId && (
        <TaskDetailPanel
          taskId={selectedTaskId}
          statuses={statuses}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={() => router.refresh()}
          onDeleted={() => { setSelectedTaskId(null); router.refresh() }}
          onOpenTask={setSelectedTaskId}
        />
      )}

      {/* Navegacion de mes */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground capitalize">{monthLabel}</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label={tr('cal.prevMonth')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)) }}
            className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {tr('gantt.today')}
          </button>
          <button
            onClick={() => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            aria-label={tr('cal.nextMonth')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Lectura de salud del proyecto (sobre todas las tareas visibles) */}
      {tasks.length > 0 && (() => {
        const total = tasks.length
        // Terminal = done o cancelled: una tarea cancelada ya no vence (coincide con las barras).
        const isTerminal = (t: Task) => t.status?.category === 'done' || t.status?.category === 'cancelled'
        const doneCount = tasks.filter(t => t.status?.category === 'done').length
        const overdueCount = tasks.filter(t => dueBucket(t.due_date, isTerminal(t)) === 'overdue').length
        const todayCount = tasks.filter(t => dueBucket(t.due_date, isTerminal(t)) === 'today').length
        const donePct = total === 0 ? 0 : Math.round((doneCount / total) * 100)
        return (
          <div className="mb-4 flex items-center gap-x-4 gap-y-1.5 flex-wrap">
            <div className="flex items-center gap-2 min-w-[160px] flex-1 max-w-[16rem]">
              <div className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary to-emerald-500 transition-all duration-500"
                  style={{ width: `${donePct}%` }}
                />
              </div>
              <span className="text-[11px] font-semibold text-foreground tabular-nums">{donePct}%</span>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground flex-wrap">
              <span className="inline-flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                <span className="tabular-nums">{doneCount}/{total}</span> {tr('health.completed')}
              </span>
              {overdueCount > 0 && (
                <span className="inline-flex items-center gap-1 text-destructive font-medium">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  <span className="tabular-nums">{overdueCount}</span> {tr('health.overdue')}
                </span>
              )}
              {todayCount > 0 && (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                  <CalendarClock className="w-3.5 h-3.5" />
                  <span className="tabular-nums">{todayCount}</span> {tr('health.today')}
                </span>
              )}
            </div>
          </div>
        )
      })()}

      {/* Leyenda de colores de las barras */}
      {dated.length > 0 && (
        <div className="mb-3 flex items-center gap-x-4 gap-y-1 flex-wrap text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#3b82f6' }} />
            {tr('cal.legendColor')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#ef4444' }} />
            {tr('health.overdue')}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#f59e0b' }} />
            {tr('health.today')}
          </span>
          <span className="w-full sm:w-auto text-muted-foreground/80">{tr('cal.dragHint')}</span>
        </div>
      )}

      {/* Encabezado de dias */}
      <div className="grid grid-cols-7 gap-px mb-px">
        {WEEKDAY_KEYS.map(k => (
          <div key={k} className="text-[11px] font-medium text-muted-foreground text-center py-1">{tr(k)}</div>
        ))}
      </div>

      {/* Rejilla */}
      <div ref={gridRef} className="rounded-lg overflow-hidden border border-border bg-border select-none">
        {weeks.map((week, wi) => {
          const bars = barsForWeek(week)
          const laneCount = bars.reduce((m, b) => Math.max(m, b.lane + 1), 0)
          const barsHeight = laneCount * 22 + 4
          return (
            <div key={wi} className="grid grid-cols-7 gap-px">
              {week.map((day, di) => {
                const inMonth = day.getMonth() === cursor.getMonth()
                const isToday = day.getTime() === today.getTime()
                return (
                  <div
                    key={di}
                    data-day={day.getTime()}
                    className={`relative min-h-[92px] p-1 transition-colors ${
                      isToday
                        ? 'bg-primary/5 ring-1 ring-inset ring-primary/40'
                        : inMonth ? 'bg-background' : 'bg-muted/30'
                    }`}
                  >
                    <div className="flex justify-end">
                      <span
                        className={`text-[11px] leading-none px-1 py-0.5 rounded ${
                          isToday
                            ? 'bg-primary text-primary-foreground font-semibold'
                            : inMonth ? 'text-foreground' : 'text-muted-foreground/50'
                        }`}
                      >
                        {day.getDate()}
                      </span>
                    </div>
                  </div>
                )
              })}

              {/* Capa de barras superpuesta sobre la fila de la semana */}
              {bars.length > 0 && (
                <div className="col-span-7 relative -mt-[80px] mb-1 mx-px pointer-events-none" style={{ height: barsHeight }}>
                  {bars.map((b, bi) => {
                    const done = b.task.status?.category === 'done' || b.task.status?.category === 'cancelled'
                    const bucket = b.task.due_date ? bucketDeFecha(b.end, done) : null
                    // Tinte por vencimiento: vencidas en rojo, para hoy en ambar; el
                    // resto conserva el color de estado o prioridad.
                    const baseColor = b.task.status?.color ?? PRIORITY_COLOR[b.task.priority] ?? PRIORITY_COLOR.none
                    const color = bucket === 'overdue' ? '#ef4444' : bucket === 'today' ? '#f59e0b' : baseColor
                    const leftPct = (b.startCol / 7) * 100
                    const widthPct = ((b.endCol - b.startCol + 1) / 7) * 100
                    const isDragging = drag?.taskId === b.task.id
                    return (
                      <div
                        key={bi}
                        className={`absolute pointer-events-auto group/bar h-[19px] ${isDragging ? 'z-20' : ''}`}
                        style={{
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          top: b.lane * 22,
                        }}
                      >
                        <div
                          onPointerDown={e => startDrag(e, b.task, b.start, b.end, 'move')}
                          title={`${b.task.title}\n${tr('cal.dragMove')}`}
                          className={`h-full w-full flex items-center gap-1 px-1.5 rounded text-[11px] font-medium cursor-grab active:cursor-grabbing hover:brightness-110 hover:ring-1 hover:ring-foreground/20 hover:shadow-sm transition-all ${
                            isDragging ? 'ring-1 ring-foreground/40 shadow-md' : ''
                          }`}
                          style={{
                            backgroundColor: `${color}2E`,
                            color,
                            borderLeft: `3px solid ${color}`,
                          }}
                        >
                          {bucket === 'overdue' ? (
                            <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                          ) : bucket === 'today' ? (
                            <CalendarClock className="w-3 h-3 flex-shrink-0" />
                          ) : (
                            <span
                              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: color }}
                            />
                          )}
                          <span className={`truncate ${done ? 'line-through opacity-70' : ''}`}>{b.task.title}</span>
                        </div>

                        {/* Manijas: solo donde la barra de verdad empieza o termina. */}
                        {!b.clipStart && (
                          <div
                            onPointerDown={e => startDrag(e, b.task, b.start, b.end, 'start')}
                            className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l opacity-0 group-hover/bar:opacity-100 transition-opacity"
                            style={{ backgroundColor: color }}
                          />
                        )}
                        {!b.clipEnd && (
                          <div
                            onPointerDown={e => startDrag(e, b.task, b.start, b.end, 'end')}
                            className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r opacity-0 group-hover/bar:opacity-100 transition-opacity"
                            style={{ backgroundColor: color }}
                          />
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {undated > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          {undated} {undated === 1 ? tr('cal.undatedOne') : tr('cal.undatedMany')} {undated === 1 ? tr('cal.undatedSuffixOne') : tr('cal.undatedSuffixMany')}
        </p>
      )}

      {tasks.length === 0 && (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted text-muted-foreground mb-3">
            <CalendarDays className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">{tr('cal.empty')}</h3>
          <p className="text-sm text-muted-foreground">
            {tr('cal.emptyHint')}
          </p>
        </div>
      )}
    </div>
  )
}

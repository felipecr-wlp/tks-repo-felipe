'use client'

/**
 * Vista de cronograma (timeline / Gantt horizontal continuo).
 *
 * A diferencia del calendario mensual (rejilla de semanas), aqui cada tarea es
 * UNA fila con una barra que abarca [start_date, due_date] sobre un eje de tiempo
 * horizontal y continuo. Se puede hacer zoom (Semana, Mes, Trimestre), navegar el
 * rango (Hoy / anterior / siguiente) y agrupar por categoria de estado.
 *
 * Una tarea con solo due_date (o solo start_date) es una barra de un dia. Las
 * tareas sin ninguna fecha NO se pierden: caen a una bandeja "Sin fechas" al pie.
 *
 * Sin dependencias de fecha externas: toda la aritmetica de dias se hace con Date
 * en hora local para respetar la zona del usuario (mismos helpers que el
 * calendario).
 *
 * Reprogramar arrastrando: arrastrar el cuerpo de la barra mueve inicio y fin
 * juntos; arrastrar sus bordes cambia solo uno de los dos. Persiste con PATCH
 * /api/tasks/[taskId] usando ISO a mediodia local para que la fecha no se corra
 * por zona horaria. Es optimista: la barra se queda donde la soltaron y solo
 * regresa si el servidor la rechaza, porque devolverla mientras responde la red
 * se lee como si el arrastre hubiera fallado.
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightSmall,
  GanttChartSquare, CalendarClock, AlertTriangle, CalendarOff, FileDown,
  MoveHorizontal,
} from 'lucide-react'
import { toast } from 'sonner'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { TaskDetailPanel } from './TaskDetailPanel'
import { useI18n } from '@/lib/i18n/LanguageProvider'
import { exportGanttToPdf, type GanttExportGroup } from '@/lib/gantt-export'
import { avanceDe, avanceIsHollow, AVANCE_COLOR, AVANCE_LABEL_KEY, AVANCE_ORDER } from '@/lib/task-progress'

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

interface TaskTimelineViewProps {
  projectId: string
  tasks: Task[]
  statuses: Status[]
  members: Member[]
  currentUserId: string
  projectName?: string
  workspaceName?: string
}

const DAY_MS = 86_400_000
const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ef4444', high: '#f97316', medium: '#eab308', low: '#3b82f6', none: '#94a3b8',
}

// Orden canonico de categorias de estado (mismo criterio que lista y tablero).
// El universo real de categorias en esta app es todo, in_progress, done,
// cancelled (no existen backlog/unstarted/started).
const CATEGORY_ORDER: Record<string, number> = {
  todo: 0, in_progress: 1, done: 2, cancelled: 3,
}
const CATEGORY_LABEL_KEY: Record<string, string> = {
  todo: 'status.catTodo', in_progress: 'status.catInProgress',
  done: 'status.catDone', cancelled: 'status.catCancelled',
}

// Niveles de zoom. "Semana" y "Mes" usan columnas por dia (distinto ancho);
// "Trimestre" agrupa en columnas por semana para que quepa el rango largo.
type Zoom = 'semana' | 'mes' | 'trimestre'
const ZOOM_CONFIG: Record<Zoom, { labelKey: string; unit: 'day' | 'week'; colWidth: number; rangeDays: number }> = {
  semana:    { labelKey: 'gantt.zoomWeek',    unit: 'day',  colWidth: 44, rangeDays: 14 },
  mes:       { labelKey: 'gantt.zoomMonth',   unit: 'day',  colWidth: 26, rangeDays: 42 },
  trimestre: { labelKey: 'gantt.zoomQuarter', unit: 'week', colWidth: 30, rangeDays: 98 },
}

const ROW_HEIGHT = 34   // alto de cada fila de tarea
const LEFT_WIDTH = 220  // ancho de la columna congelada (titulos)

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

function startOfDay(d: Date): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
function addDays(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n) }
function parseDay(iso: string): Date { const d = new Date(iso); return new Date(d.getFullYear(), d.getMonth(), d.getDate()) }
// Indice desde el lunes (0 = Lun ... 6 = Dom), para alinear columnas por semana.
function mondayIndex(d: Date): number { return (d.getDay() + 6) % 7 }
function daysBetween(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / DAY_MS) }
// ISO a mediodia local: parseDay (que usa Y/M/D local) recupera el mismo dia.
function noonIso(d: Date): string { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0).toISOString() }
function fmtDay(d: Date, locale: string): string { return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) }

interface DatedTask { task: Task; start: Date; end: Date }

/** Modo de color de la barra. `avance` es el semaforo de arranque. */
type ColorBy = 'phase' | 'priority' | 'avance'

const DRAG_THRESHOLD = 4
type DragMode = 'move' | 'start' | 'end'
interface DragState { taskId: string; start: Date; end: Date; moved: boolean; x: number; y: number }
interface DragSession {
  taskId: string; mode: DragMode; startClientX: number
  origStart: Date; origEnd: Date; curStart: Date; curEnd: Date
  moved: boolean
}

export function TaskTimelineView({ projectId, tasks, statuses, members, currentUserId, projectName, workspaceName }: TaskTimelineViewProps) {
  const router = useRouter()
  const { t: tr, lang } = useI18n()
  const locale = lang === 'en' ? 'en-US' : 'es-MX'
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [zoom, setZoom] = useState<Zoom>('mes')
  const [colorBy, setColorBy] = useState<ColorBy>('phase')
  // Ancla del rango visible: inicio del periodo. Arranca en HOY menos un margen.
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [showUndated, setShowUndated] = useState(false)
  // Modal de portada del PDF: nombre del cliente y direccion (editables).
  const [exportOpen, setExportOpen] = useState(false)
  const [clientName, setClientName] = useState('')
  const [serviceAddress, setServiceAddress] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useRealtimeRefresh({
    channel: `proj-timeline-${projectId}`,
    tables: [
      { table: 'tasks',         filter: `project_id=eq.${projectId}` },
      { table: 'task_statuses', filter: `project_id=eq.${projectId}` },
    ],
  })

  const today = startOfDay(new Date())
  const cfg = ZOOM_CONFIG[zoom]

  // Fechas optimistas por tarea mientras el servidor confirma el PATCH. Al
  // llegar tareas nuevas del servidor (realtime -> refresh) ya no hacen falta:
  // la prop trae el valor confirmado.
  const [overrides, setOverrides] = useState<Record<string, { start_date: string; due_date: string }>>({})
  useEffect(() => { setOverrides({}) }, [tasks])

  // Rango de tarea: [start, end] en dias. Requiere al menos una de las fechas.
  const dated = useMemo<DatedTask[]>(() => tasks.map(t => {
    const ov = overrides[t.id]
    const dueStr = ov?.due_date ?? t.due_date
    const startStr = ov?.start_date ?? t.start_date
    const due = dueStr ? parseDay(dueStr) : null
    const start = startStr ? parseDay(startStr) : null
    if (!due && !start) return null
    const s = start ?? due!
    const e = due ?? start!
    return { task: t, start: s <= e ? s : e, end: s <= e ? e : s }
  }).filter((x): x is DatedTask => x != null), [tasks, overrides])

  const undated = useMemo(() => tasks.filter(t => {
    const ov = overrides[t.id]
    return !(ov?.due_date ?? t.due_date) && !(ov?.start_date ?? t.start_date)
  }), [tasks, overrides])

  // Inicio de la rejilla alineado a lunes (para que las columnas por semana
  // caigan limpias) y ancho total en dias segun el zoom.
  const gridStart = useMemo(() => addDays(anchor, -mondayIndex(anchor)), [anchor])
  const totalDays = cfg.rangeDays
  const gridEnd = useMemo(() => addDays(gridStart, totalDays - 1), [gridStart, totalDays])

  // Columnas del eje: por dia o por semana segun el zoom.
  interface Col { date: Date; dayOffset: number; span: number }
  const columns = useMemo<Col[]>(() => {
    const cols: Col[] = []
    if (cfg.unit === 'day') {
      for (let i = 0; i < totalDays; i++) {
        cols.push({ date: addDays(gridStart, i), dayOffset: i, span: 1 })
      }
    } else {
      // Columnas por semana: una cada 7 dias desde gridStart (ya alineado a lunes).
      for (let i = 0; i < totalDays; i += 7) {
        cols.push({ date: addDays(gridStart, i), dayOffset: i, span: 7 })
      }
    }
    return cols
  }, [cfg.unit, gridStart, totalDays])

  const pxPerDay = cfg.unit === 'day' ? cfg.colWidth : cfg.colWidth / 7
  const gridWidth = totalDays * pxPerDay

  // Posicion horizontal (left, width) de una barra recortada al rango visible.
  function barGeometry(start: Date, end: Date): { left: number; width: number; clipStart: boolean; clipEnd: boolean } | null {
    if (end < gridStart || start > gridEnd) return null // fuera del rango
    const clampedStart = start < gridStart ? gridStart : start
    const clampedEnd = end > gridEnd ? gridEnd : end
    const startOff = daysBetween(gridStart, clampedStart)
    const endOff = daysBetween(gridStart, clampedEnd)
    const left = startOff * pxPerDay
    const width = Math.max((endOff - startOff + 1) * pxPerDay, 8)
    return { left, width, clipStart: start < gridStart, clipEnd: end > gridEnd }
  }

  // ── Reprogramar arrastrando ───────────────────────────────────────────────
  function commitDates(taskId: string, start: Date, end: Date) {
    const s = start <= end ? start : end
    const e = start <= end ? end : start
    const startIso = noonIso(s)
    const dueIso = noonIso(e)
    setOverrides(o => ({ ...o, [taskId]: { start_date: startIso, due_date: dueIso } }))
    fetch(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_date: startIso, due_date: dueIso }),
    })
      .then(res => {
        if (!res.ok) {
          toast.error(res.status === 403 ? tr('toast.moveNoAccess') : tr('toast.moveFailed'))
          setOverrides(o => { const n = { ...o }; delete n[taskId]; return n })
        } else {
          toast.success(tr('toast.dateUpdated'))
          router.refresh()
        }
      })
      .catch(() => {
        toast.error(tr('toast.moveNetwork'))
        setOverrides(o => { const n = { ...o }; delete n[taskId]; return n })
      })
  }

  // Los listeners se montan UNA vez y leen refs. Volver a suscribirlos en cada
  // movimiento del puntero perderia eventos a mitad del arrastre.
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragSession = useRef<DragSession | null>(null)
  const helpersRef = useRef({ pxPerDay, commitDates, openTask: setSelectedTaskId })
  helpersRef.current = { pxPerDay, commitDates, openTask: setSelectedTaskId }

  useEffect(() => {
    function onMove(e: PointerEvent) {
      const sess = dragSession.current
      if (!sess) return
      const { pxPerDay: ppd } = helpersRef.current
      const dx = e.clientX - sess.startClientX
      if (Math.abs(dx) > DRAG_THRESHOLD) sess.moved = true
      const deltaDays = Math.round(dx / ppd)
      let ns = sess.origStart
      let ne = sess.origEnd
      if (sess.mode === 'move') {
        ns = addDays(sess.origStart, deltaDays)
        ne = addDays(sess.origEnd, deltaDays)
      } else if (sess.mode === 'start') {
        ns = addDays(sess.origStart, deltaDays)
        if (ns > sess.origEnd) ns = sess.origEnd
        ne = sess.origEnd
      } else {
        ne = addDays(sess.origEnd, deltaDays)
        if (ne < sess.origStart) ne = sess.origStart
        ns = sess.origStart
      }
      sess.curStart = ns
      sess.curEnd = ne
      setDrag({ taskId: sess.taskId, start: ns, end: ne, moved: sess.moved, x: e.clientX, y: e.clientY })
    }
    function onUp() {
      const sess = dragSession.current
      dragSession.current = null
      if (!sess) { setDrag(null); return }
      const h = helpersRef.current
      // Sin desplazamiento real fue un clic: abre la tarea, no reprograma.
      if (!sess.moved) {
        h.openTask(sess.taskId)
      } else {
        const changed = sess.curStart.getTime() !== sess.origStart.getTime()
          || sess.curEnd.getTime() !== sess.origEnd.getTime()
        if (changed) h.commitDates(sess.taskId, sess.curStart, sess.curEnd)
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

  function startDrag(e: React.PointerEvent, taskId: string, start: Date, end: Date, mode: DragMode) {
    e.preventDefault()
    e.stopPropagation()
    dragSession.current = {
      taskId, mode, startClientX: e.clientX,
      origStart: start, origEnd: end, curStart: start, curEnd: end, moved: false,
    }
    setDrag({ taskId, start, end, moved: false, x: e.clientX, y: e.clientY })
  }

  // Agrupar tareas con fecha por categoria de estado, ordenadas por inicio.
  interface Group { key: string; labelKey: string; items: DatedTask[] }
  const groups = useMemo<Group[]>(() => {
    const byCat = new Map<string, DatedTask[]>()
    for (const d of dated) {
      const cat = d.task.status?.category ?? 'todo'
      const arr = byCat.get(cat) ?? []
      arr.push(d)
      byCat.set(cat, arr)
    }
    return Array.from(byCat.entries())
      .map(([key, items]) => ({
        key,
        labelKey: CATEGORY_LABEL_KEY[key] ?? key,
        items: items.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime()),
      }))
      .sort((a, b) => (CATEGORY_ORDER[a.key] ?? 99) - (CATEGORY_ORDER[b.key] ?? 99))
  }, [dated])

  // Conteo por cubo de avance, para la leyenda.
  const avanceCount = useMemo(() => {
    const acc: Partial<Record<ReturnType<typeof avanceDe>, number>> = {}
    for (const d of dated) {
      const a = avanceDe(d.task.status?.category, d.start, today)
      acc[a] = (acc[a] ?? 0) + 1
    }
    return acc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dated])

  // Centrar el scroll horizontal en HOY al montar y al cambiar de zoom/ancla.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const todayOff = daysBetween(gridStart, today)
    const todayPx = todayOff * pxPerDay
    // Dejar HOY a ~1/3 del viewport para ver algo de pasado y futuro.
    el.scrollLeft = Math.max(0, todayPx - el.clientWidth / 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, anchor])

  function shiftRange(dir: -1 | 1) {
    // Avanzar/retroceder aproximadamente medio rango visible.
    setAnchor(a => addDays(a, dir * Math.round(totalDays / 2)))
  }

  // ── Export PDF branded WLP (solo lectura; TODAS las tareas con fecha, no solo
  // el rango visible en pantalla). El color de la barra respeta estado o prioridad.
  function handleExportPdf() {
    if (groups.length === 0 && undated.length === 0) {
      toast.info(tr('gantt.pdfEmpty'))
      return
    }
    const ymd = (dt: Date) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const exportGroups: GanttExportGroup[] = groups.map(g => ({
      category: g.key,
      label: tr(g.labelKey),
      items: g.items.map(d => {
        const t = d.task
        const done = t.status?.category === 'done' || t.status?.category === 'cancelled'
        const overdue = dueBucket(t.due_date, done) === 'overdue'
        const priorityColor = PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR.none
        // Prioridad de color de la barra: color de ETIQUETA/FASE (Phase 1, Phase 2...)
        // si existe, luego el color del estado, luego el de prioridad. Asi el Gantt
        // hereda los colores por fase que Karla ya ve en la lista (no sale todo gris).
        const firstLabel = t.labels && t.labels.length > 0 ? t.labels[0] : undefined
        const color = firstLabel?.color ?? t.status?.color ?? priorityColor
        return {
          title: t.title,
          assignee: t.assignee?.display_name ?? null,
          priority: t.priority,
          color,
          start: ymd(d.start),
          end: ymd(d.end),
          done,
          overdue,
          label: firstLabel ? { name: firstLabel.name, color: firstLabel.color } : undefined,
        }
      }),
    }))
    // El PDF SIEMPRE se genera en ingles (entregable de cara al cliente).
    exportGanttToPdf({
      documentTitle: 'Project Schedule',
      title: projectName ?? '',
      subtitle: workspaceName ?? '',
      groups: exportGroups,
      undated: undated.map(t => ({ title: t.title })),
      cover: {
        clientName: clientName.trim(),
        serviceAddress: serviceAddress.trim(),
      },
    })
    setExportOpen(false)
  }

  const rangeLabel = `${gridStart.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} - ${gridEnd.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
  const todayOffset = daysBetween(gridStart, today)
  const todayInRange = todayOffset >= 0 && todayOffset < totalDays
  const todayLinePx = todayOffset * pxPerDay + pxPerDay / 2

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

      {/* Barra superior: titulo del rango, control de zoom y navegacion */}
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <GanttChartSquare className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground capitalize">{rangeLabel}</h2>
          <span className="hidden md:inline-flex items-center gap-1 text-[11px] text-muted-foreground/70">
            <MoveHorizontal className="w-3.5 h-3.5" />
            {tr('gantt.reprogramHint')}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Colorear por: fase, prioridad o avance */}
          <div className="inline-flex items-center rounded-md border border-border overflow-hidden" title={tr('gantt.colorByTitle')}>
            {(['phase', 'priority', 'avance'] as const).map(mode => (
              <button
                key={mode}
                onClick={() => setColorBy(mode)}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  colorBy === mode
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                aria-pressed={colorBy === mode}
              >
                {mode === 'phase'
                  ? tr('gantt.colorByPhase')
                  : mode === 'priority'
                    ? tr('gantt.colorByPriority')
                    : tr('gantt.colorByAvance')}
              </button>
            ))}
          </div>

          {/* Control segmentado de zoom */}
          <div className="inline-flex items-center rounded-md border border-border overflow-hidden">
            {(Object.keys(ZOOM_CONFIG) as Zoom[]).map(z => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`px-2.5 py-1 text-xs transition-colors ${
                  zoom === z
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                aria-pressed={zoom === z}
              >
                {tr(ZOOM_CONFIG[z].labelKey)}
              </button>
            ))}
          </div>

          {/* Navegacion del rango */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => shiftRange(-1)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label={tr('gantt.prevRange')}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setAnchor(startOfDay(new Date()))}
              className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {tr('gantt.today')}
            </button>
            <button
              onClick={() => shiftRange(1)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label={tr('gantt.nextRange')}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* Export PDF branded WLP: abre modal para la portada del cliente */}
          <button
            onClick={() => {
              if (groups.length === 0 && undated.length === 0) {
                toast.info(tr('gantt.pdfEmpty'))
                return
              }
              setExportOpen(true)
            }}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={tr('gantt.exportPdfTitle')}
          >
            <FileDown className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{tr('gantt.exportPdf')}</span>
          </button>
        </div>
      </div>

      {/* Leyenda del semaforo de avance. Solo aparece en ese modo: una leyenda
          permanente para colores que no se estan usando es ruido. Los conteos
          son de TODAS las tareas con fecha, no solo del rango visible: "3 no
          arrancaron" deja de servir si depende de a donde este el scroll. */}
      {colorBy === 'avance' && (
        <div className="flex items-center gap-3 flex-wrap mb-3 px-1">
          {AVANCE_ORDER.map(a => {
            const n = avanceCount[a] ?? 0
            if (n === 0) return null
            return (
              <span key={a} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className="w-3 h-3 rounded-sm flex-shrink-0"
                  style={{
                    backgroundColor: avanceIsHollow(a) ? 'transparent' : `${AVANCE_COLOR[a]}44`,
                    border: `1px ${avanceIsHollow(a) ? 'dashed' : 'solid'} ${AVANCE_COLOR[a]}`,
                  }}
                />
                {tr(AVANCE_LABEL_KEY[a])}
                <span className="tabular-nums font-medium text-foreground">{n}</span>
              </span>
            )
          })}
        </div>
      )}

      {/* Modal de portada del PDF (nombre del cliente + direccion, editables) */}
      {exportOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setExportOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-border bg-background shadow-xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center gap-2.5 px-5 pt-5 pb-1">
              <div className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-primary/15 text-primary">
                <FileDown className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">{tr('gantt.pdfCoverTitle')}</h3>
                <p className="text-xs text-muted-foreground">{tr('gantt.pdfCoverHint')}</p>
              </div>
            </div>

            <div className="px-5 py-4 space-y-3">
              <label className="block">
                <span className="text-xs font-medium text-foreground">{tr('gantt.pdfClientName')}</span>
                <input
                  autoFocus
                  value={clientName}
                  onChange={e => setClientName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleExportPdf() }}
                  placeholder={tr('gantt.pdfClientPlaceholder')}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-foreground">{tr('gantt.pdfServiceAddress')}</span>
                <input
                  value={serviceAddress}
                  onChange={e => setServiceAddress(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleExportPdf() }}
                  placeholder={tr('gantt.pdfAddressPlaceholder')}
                  className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/40"
                />
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 pb-5">
              <button
                onClick={() => setExportOpen(false)}
                className="px-3 py-1.5 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                {tr('common.cancel')}
              </button>
              <button
                onClick={handleExportPdf}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
              >
                <FileDown className="w-3.5 h-3.5" />
                {tr('gantt.pdfGenerate')}
              </button>
            </div>
          </div>
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted text-muted-foreground mb-3">
            <GanttChartSquare className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">{tr('timeline.empty')}</h3>
          <p className="text-sm text-muted-foreground">
            {tr('timeline.emptyHint')}
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden bg-background">
          {/* Contenedor con scroll horizontal. La columna izquierda queda sticky. */}
          <div ref={scrollRef} className="overflow-x-auto">
            <div style={{ width: LEFT_WIDTH + gridWidth }}>
              {/* Encabezado de fechas */}
              <div className="flex sticky top-0 z-20 bg-background border-b border-border">
                <div
                  className="sticky left-0 z-30 bg-background border-r border-border flex items-center px-3 text-[11px] font-medium text-muted-foreground"
                  style={{ width: LEFT_WIDTH, minWidth: LEFT_WIDTH }}
                >
                  {tr('timeline.taskHeader')}
                </div>
                <div className="relative" style={{ width: gridWidth }}>
                  <div className="flex">
                    {columns.map((col, i) => {
                      const isTodayCol = cfg.unit === 'day'
                        ? col.date.getTime() === today.getTime()
                        : today >= col.date && today < addDays(col.date, 7)
                      const width = col.span * pxPerDay
                      return (
                        <div
                          key={i}
                          className={`text-center py-1.5 border-r border-border/50 ${
                            isTodayCol ? 'bg-primary/5' : ''
                          }`}
                          style={{ width, minWidth: width }}
                        >
                          {cfg.unit === 'day' ? (
                            <>
                              <div className="text-[10px] leading-none text-muted-foreground/70 uppercase">
                                {col.date.toLocaleDateString(locale, { weekday: 'narrow' })}
                              </div>
                              <div className={`text-[11px] leading-tight mt-0.5 ${
                                isTodayCol ? 'text-primary font-semibold' : 'text-foreground'
                              }`}>
                                {col.date.getDate()}
                              </div>
                            </>
                          ) : (
                            <div className={`text-[11px] leading-tight ${
                              isTodayCol ? 'text-primary font-semibold' : 'text-foreground'
                            }`}>
                              {col.date.toLocaleDateString(locale, { day: 'numeric', month: 'short' })}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Cuerpo: grupos colapsables con una fila por tarea */}
              <div className="relative">
                {/* Linea vertical de HOY sobre todo el cuerpo */}
                {todayInRange && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-primary/60 z-10 pointer-events-none"
                    style={{ left: LEFT_WIDTH + todayLinePx }}
                  >
                    <span className="absolute -top-0.5 -left-[3px] w-[7px] h-[7px] rounded-full bg-primary" />
                  </div>
                )}

                {groups.map(group => {
                  const isCollapsed = collapsed[group.key]
                  return (
                    <div key={group.key}>
                      {/* Encabezado de grupo (colapsable) */}
                      <button
                        onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}
                        className="flex items-center gap-1.5 w-full sticky left-0 z-[15] bg-muted/40 hover:bg-muted/70 border-y border-border px-3 py-1.5 text-[11px] font-semibold text-foreground transition-colors"
                        style={{ width: LEFT_WIDTH + gridWidth }}
                      >
                        {isCollapsed
                          ? <ChevronRightSmall className="w-3.5 h-3.5 text-muted-foreground" />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                        <span className="sticky left-8">{tr(group.labelKey)}</span>
                        <span className="text-muted-foreground font-normal tabular-nums">{group.items.length}</span>
                      </button>

                      {!isCollapsed && group.items.map(d => {
                        const t = d.task
                        const isDragging = drag?.taskId === t.id
                        const effStart = isDragging ? drag!.start : d.start
                        const effEnd = isDragging ? drag!.end : d.end
                        const done = t.status?.category === 'done' || t.status?.category === 'cancelled'
                        const bucket = dueBucket(t.due_date, done)
                        const priorityColor = PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR.none
                        const avance = avanceDe(t.status?.category, d.start, today)
                        // "Fase" es el color que Karla ya reconoce en la lista:
                        // etiqueta primero, estado despues, prioridad al final.
                        const firstLabel = t.labels && t.labels.length > 0 ? t.labels[0] : undefined
                        const baseColor = colorBy === 'avance'
                          ? AVANCE_COLOR[avance]
                          : colorBy === 'priority'
                            ? priorityColor
                            : (firstLabel?.color ?? t.status?.color ?? priorityColor)
                        const hollow = colorBy === 'avance' && avanceIsHollow(avance)
                        const geom = barGeometry(effStart, effEnd)
                        const initials = t.assignee?.display_name
                          ? t.assignee.display_name.trim().slice(0, 2).toUpperCase()
                          : null
                        return (
                          <div
                            key={t.id}
                            className="flex border-b border-border/50 hover:bg-muted/30 transition-colors group"
                            style={{ height: ROW_HEIGHT }}
                          >
                            {/* Columna congelada: titulo + estado + asignado */}
                            <button
                              onClick={() => setSelectedTaskId(t.id)}
                              className="sticky left-0 z-[5] bg-background group-hover:bg-muted/30 border-r border-border flex items-center gap-2 px-3 text-left transition-colors"
                              style={{ width: LEFT_WIDTH, minWidth: LEFT_WIDTH }}
                              title={t.title}
                            >
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: t.status?.color ?? baseColor }}
                              />
                              <span className={`text-xs truncate flex-1 ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                                {t.title}
                              </span>
                              {t.assignee?.avatar_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={t.assignee.avatar_url}
                                  alt={t.assignee.display_name}
                                  className="w-5 h-5 rounded-full flex-shrink-0 object-cover"
                                />
                              ) : initials ? (
                                <span className="w-5 h-5 rounded-full flex-shrink-0 bg-muted text-[9px] font-medium text-muted-foreground flex items-center justify-center">
                                  {initials}
                                </span>
                              ) : null}
                            </button>

                            {/* Carril de la barra */}
                            <div className="relative" style={{ width: gridWidth }}>
                              {geom && (
                                <div
                                  className={`absolute top-1/2 -translate-y-1/2 h-[20px] group/bar select-none ${isDragging ? 'z-20' : ''}`}
                                  style={{ left: geom.left + 1, width: geom.width - 2 }}
                                >
                                  <div
                                    onPointerDown={e => startDrag(e, t.id, effStart, effEnd, 'move')}
                                    title={t.title}
                                    className={`h-full w-full flex items-center gap-1 px-1.5 rounded text-[11px] font-medium cursor-grab active:cursor-grabbing hover:brightness-110 hover:shadow-sm transition-[filter,box-shadow] ${
                                      bucket === 'overdue' ? 'ring-1 ring-destructive/70' : ''
                                    } ${isDragging ? 'ring-1 ring-foreground/40 shadow-md' : ''}`}
                                    style={{
                                      backgroundColor: done || hollow ? 'transparent' : `${baseColor}22`,
                                      color: done ? undefined : baseColor,
                                      borderLeft: geom.clipStart ? undefined : `2px solid ${baseColor}`,
                                      borderRight: geom.clipEnd ? `2px solid ${baseColor}` : undefined,
                                      // Hueca y rayada: lo que no arranco no debe
                                      // parecer trabajo en curso ni de lejos.
                                      border: hollow ? `1px dashed ${baseColor}` : undefined,
                                      backgroundImage: done
                                        ? 'repeating-linear-gradient(45deg, var(--muted, #64748b22) 0, var(--muted, #64748b22) 4px, transparent 4px, transparent 8px)'
                                        : hollow
                                          ? `repeating-linear-gradient(45deg, ${baseColor}1f 0, ${baseColor}1f 3px, transparent 3px, transparent 7px)`
                                          : undefined,
                                    }}
                                  >
                                    {bucket === 'overdue' && <AlertTriangle className="w-3 h-3 flex-shrink-0" />}
                                    {bucket === 'today' && <CalendarClock className="w-3 h-3 flex-shrink-0" />}
                                    <span className={`truncate ${done ? 'text-muted-foreground line-through' : ''}`}>
                                      {t.title}
                                    </span>
                                  </div>

                                  {/* Manija izquierda (cambia inicio) */}
                                  {!geom.clipStart && (
                                    <div
                                      onPointerDown={e => startDrag(e, t.id, effStart, effEnd, 'start')}
                                      className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l opacity-0 group-hover/bar:opacity-100 transition-opacity"
                                      style={{ backgroundColor: baseColor }}
                                    />
                                  )}
                                  {/* Manija derecha (cambia fin) */}
                                  {!geom.clipEnd && (
                                    <div
                                      onPointerDown={e => startDrag(e, t.id, effStart, effEnd, 'end')}
                                      className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r opacity-0 group-hover/bar:opacity-100 transition-opacity"
                                      style={{ backgroundColor: baseColor }}
                                    />
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Bandeja "Sin fechas": las tareas sin ninguna fecha no se pierden */}
          {undated.length > 0 && (
            <div className="border-t border-border bg-muted/20">
              <button
                onClick={() => setShowUndated(s => !s)}
                className="flex items-center gap-1.5 w-full px-3 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                {showUndated
                  ? <ChevronDown className="w-3.5 h-3.5" />
                  : <ChevronRightSmall className="w-3.5 h-3.5" />}
                <CalendarOff className="w-3.5 h-3.5" />
                <span>{tr('gantt.undated')}</span>
                <span className="tabular-nums">{undated.length}</span>
              </button>
              {showUndated && (
                <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                  {undated.map(t => {
                    const done = t.status?.category === 'done' || t.status?.category === 'cancelled'
                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTaskId(t.id)}
                        title={t.title}
                        className="inline-flex items-center gap-1.5 max-w-[220px] px-2 py-1 rounded border border-border bg-background text-xs hover:bg-muted transition-colors"
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: t.status?.color ?? PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR.none }}
                        />
                        <span className={`truncate ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                          {t.title}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Etiqueta flotante con las fechas nuevas mientras se arrastra. Sin ella
          el arrastre es a ciegas: la rejilla dice el dia pero no la fecha. */}
      {drag && drag.moved && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1 rounded-md bg-foreground text-background text-[11px] font-medium shadow-lg tabular-nums"
          style={{ left: drag.x + 14, top: drag.y + 14 }}
        >
          {fmtDay(drag.start, locale)} {tr('gantt.rangeTo')} {fmtDay(drag.end, locale)}
          <span className="ml-1 opacity-70">({daysBetween(drag.start, drag.end) + 1}{tr('gantt.days')})</span>
        </div>
      )}
    </div>
  )
}

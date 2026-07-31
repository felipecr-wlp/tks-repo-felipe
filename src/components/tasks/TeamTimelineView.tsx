'use client'

/**
 * Cronograma (Gantt) a nivel EQUIPO, interactivo.
 *
 * A diferencia de TaskTimelineView (que es por proyecto y agrupa por categoria
 * de estado), esta vista AGREGA todas las tareas de TODOS los proyectos del
 * equipo en un solo eje de tiempo y las agrupa por PROYECTO. Sirve para ver de
 * un vistazo la carga y los vencimientos del equipo completo.
 *
 * Interactividad:
 *  - Arrastrar el cuerpo de una barra reprograma (mueve inicio y fin juntos).
 *  - Arrastrar los bordes izquierdo/derecho redimensiona (cambia inicio o fin).
 *  - Persiste con PATCH /api/tasks/[taskId] usando ISO a mediodia local para que
 *    la fecha no se corra por zona horaria. Optimista + toast + manejo de 403.
 *  - Tooltip flotante al pasar el cursor, con proyecto, estado, responsable,
 *    fechas y duracion.
 *  - Barra de filtros: buscador, prioridad, responsable, solo vencidas y chips
 *    de proyecto.
 *
 * Como las tareas viven en proyectos distintos (cada uno con sus propios estados
 * y miembros), al hacer clic (sin arrastrar) se navega a la tarea dentro de su
 * proyecto, donde el detalle si tiene el contexto correcto.
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightSmall,
  GanttChartSquare, CalendarClock, AlertTriangle, CalendarOff,
  Search, X, SlidersHorizontal, MoveHorizontal, Trash2, Loader2,
  ArrowDownUp, Layers, FileDown,
} from 'lucide-react'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { ProjectIcon } from '@/lib/project-icons'
import { useI18n } from '@/lib/i18n/LanguageProvider'
import { exportGanttToPdf, type GanttExportGroup } from '@/lib/gantt-export'
import { avanceDe, avanceIsHollow, AVANCE_COLOR, AVANCE_LABEL_KEY, AVANCE_ORDER } from '@/lib/task-progress'

interface TeamTask {
  id: string
  title: string
  priority: string
  due_date: string | null
  start_date: string | null
  status: { category: string; color: string | null } | null
  assignee: { display_name: string; avatar_url: string | null } | null
  project: { id: string; name: string; slug: string; icon: string | null }
}

interface TeamTimelineViewProps {
  teamId: string
  projectIds: string[]
  workspaceSlug: string
  teamSlug: string
  teamName: string
  workspaceName: string
  tasks: TeamTask[]
}

const DAY_MS = 86_400_000
const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ef4444', high: '#f97316', medium: '#eab308', low: '#3b82f6', none: '#94a3b8',
}
const PRIORITY_RANK: Record<string, number> = {
  urgent: 0, high: 1, medium: 2, low: 3, none: 4,
}
type SortKey = 'start' | 'due' | 'priority' | 'title'
type SortDir = 'asc' | 'desc'
type GroupMode = 'project' | 'none' | 'assignee'
type Zoom = 'semana' | 'mes' | 'trimestre'
const ZOOM_CONFIG: Record<Zoom, { labelKey: string; unit: 'day' | 'week'; colWidth: number; rangeDays: number }> = {
  semana:    { labelKey: 'gantt.zoomWeek',    unit: 'day',  colWidth: 44, rangeDays: 14 },
  mes:       { labelKey: 'gantt.zoomMonth',   unit: 'day',  colWidth: 26, rangeDays: 42 },
  trimestre: { labelKey: 'gantt.zoomQuarter', unit: 'week', colWidth: 30, rangeDays: 98 },
}

const ROW_HEIGHT = 34
const LEFT_WIDTH = 220
const DRAG_THRESHOLD = 4

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
function mondayIndex(d: Date): number { return (d.getDay() + 6) % 7 }
function daysBetween(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / DAY_MS) }
// ISO a mediodia local: parseDay (que usa Y/M/D local) recupera el mismo dia.
function noonIso(d: Date): string { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0).toISOString() }
function fmtDay(d: Date, locale: string): string { return d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }) }

interface DatedTask { task: TeamTask; start: Date; end: Date }
type DragMode = 'move' | 'start' | 'end'
interface DragState { taskId: string; start: Date; end: Date; moved: boolean; x: number; y: number }
interface DragSession {
  taskId: string; mode: DragMode; startClientX: number
  origStart: Date; origEnd: Date; curStart: Date; curEnd: Date
  moved: boolean; task: TeamTask
}

export function TeamTimelineView({ teamId, projectIds, workspaceSlug, teamSlug, teamName, workspaceName, tasks }: TeamTimelineViewProps) {
  const router = useRouter()
  const { t: tr, lang } = useI18n()
  const locale = lang === 'en' ? 'en-US' : 'es-MX'
  const [zoom, setZoom] = useState<Zoom>('mes')
  const [colorBy, setColorBy] = useState<'priority' | 'status' | 'avance'>('priority')
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [showUndated, setShowUndated] = useState(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Fechas optimistas por tarea mientras el servidor confirma el PATCH.
  const [overrides, setOverrides] = useState<Record<string, { start_date: string; due_date: string }>>({})
  // Al llegar tareas nuevas del servidor (realtime -> refresh), los overrides
  // ya no hacen falta: la prop trae el valor confirmado.
  useEffect(() => { setOverrides({}) }, [tasks])

  // Filtros
  const [search, setSearch] = useState('')
  const [selPriority, setSelPriority] = useState<string>('all')
  const [selAssignee, setSelAssignee] = useState<string>('all')
  const [onlyOverdue, setOnlyOverdue] = useState(false)
  const [selProjects, setSelProjects] = useState<Set<string>>(new Set())
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  // Orden y agrupado (solo afectan la vista, no la base)
  const [sortKey, setSortKey] = useState<SortKey>('start')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [groupMode, setGroupMode] = useState<GroupMode>('project')

  // Tooltip flotante
  const [hover, setHover] = useState<{ task: TeamTask; start: Date; end: Date; x: number; y: number } | null>(null)

  // Suscripcion en vivo a las tareas de TODOS los proyectos del equipo.
  useRealtimeRefresh({
    channel: `team-timeline-${teamId}`,
    tables: projectIds.length > 0
      ? [{ table: 'tasks', filter: `project_id=in.(${projectIds.join(',')})` }]
      : [],
  })

  function openTask(t: TeamTask) {
    router.push(`/w/${workspaceSlug}/t/${teamSlug}/p/${t.project.slug}?task=${t.id}`)
  }

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
      .then(async res => {
        if (!res.ok) {
          if (res.status === 403) toast.error(tr('toast.moveNoAccess'))
          else toast.error(tr('toast.moveFailed'))
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

  // ── Borrado con doble confirmacion ────────────────────────────────────────
  const [pendingDelete, setPendingDelete] = useState<TeamTask | null>(null)
  const [deleteStage, setDeleteStage] = useState<1 | 2>(1)
  const [deleting, setDeleting] = useState(false)

  function requestDelete(t: TeamTask) { setPendingDelete(t); setDeleteStage(1) }

  async function advanceDelete() {
    if (!pendingDelete) return
    if (deleteStage === 1) { setDeleteStage(2); return }
    setDeleting(true)
    try {
      const res = await fetch(`/api/tasks/${pendingDelete.id}`, { method: 'DELETE' })
      if (res.ok) {
        toast.success(tr('toast.taskDeleted'))
        setPendingDelete(null)
        router.refresh()
      } else if (res.status === 403) {
        toast.error(tr('toast.deleteNoAccess'))
      } else {
        toast.error(tr('toast.deleteFailed'))
      }
    } catch {
      toast.error(tr('toast.deleteNetwork'))
    } finally {
      setDeleting(false)
    }
  }

  const today = startOfDay(new Date())
  const cfg = ZOOM_CONFIG[zoom]
  const pxPerDay = cfg.unit === 'day' ? cfg.colWidth : cfg.colWidth / 7

  // ── Drag global: listeners montados una sola vez, leen refs ────────────────
  const [drag, setDrag] = useState<DragState | null>(null)
  const dragSession = useRef<DragSession | null>(null)
  const helpersRef = useRef({ pxPerDay, openTask, commitDates })
  helpersRef.current = { pxPerDay, openTask, commitDates }

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
      if (!sess.moved) {
        h.openTask(sess.task)
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

  function startDrag(e: React.PointerEvent, d: DatedTask, mode: DragMode) {
    e.preventDefault()
    e.stopPropagation()
    setHover(null)
    dragSession.current = {
      taskId: d.task.id, mode, startClientX: e.clientX,
      origStart: d.start, origEnd: d.end, curStart: d.start, curEnd: d.end,
      moved: false, task: d.task,
    }
    setDrag({ taskId: d.task.id, start: d.start, end: d.end, moved: false, x: e.clientX, y: e.clientY })
  }

  // ── Opciones de filtro (derivadas de todas las tareas, estables) ───────────
  const projectOptions = useMemo(() => {
    const m = new Map<string, TeamTask['project']>()
    for (const t of tasks) if (!m.has(t.project.id)) m.set(t.project.id, t.project)
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'))
  }, [tasks])

  const assigneeOptions = useMemo(() => {
    const s = new Set<string>()
    for (const t of tasks) if (t.assignee?.display_name) s.add(t.assignee.display_name)
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'es'))
  }, [tasks])

  const dateFilterActive = dateFrom !== '' || dateTo !== ''
  const anyFilter = search.trim() !== '' || selPriority !== 'all' || selAssignee !== 'all' || onlyOverdue || selProjects.size > 0 || dateFilterActive

  function clearFilters() {
    setSearch(''); setSelPriority('all'); setSelAssignee('all'); setOnlyOverdue(false)
    setSelProjects(new Set()); setDateFrom(''); setDateTo('')
  }

  const visibleTasks = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasks.filter(t => {
      if (selProjects.size > 0 && !selProjects.has(t.project.id)) return false
      if (selPriority !== 'all' && t.priority !== selPriority) return false
      if (selAssignee !== 'all' && (t.assignee?.display_name ?? '') !== selAssignee) return false
      if (q && !t.title.toLowerCase().includes(q) && !t.project.name.toLowerCase().includes(q)) return false
      if (onlyOverdue) {
        const done = t.status?.category === 'done' || t.status?.category === 'cancelled'
        if (dueBucket(t.due_date, done) !== 'overdue') return false
      }
      return true
    })
  }, [tasks, selProjects, selPriority, selAssignee, search, onlyOverdue])

  // Fechas efectivas (con overrides optimistas aplicados) + filtro por rango.
  const dated = useMemo<DatedTask[]>(() => {
    const from = dateFrom ? new Date(dateFrom + 'T00:00:00') : null
    const to = dateTo ? new Date(dateTo + 'T00:00:00') : null
    return visibleTasks.map(t => {
      const ov = overrides[t.id]
      const dueStr = ov?.due_date ?? t.due_date
      const startStr = ov?.start_date ?? t.start_date
      const due = dueStr ? parseDay(dueStr) : null
      const start = startStr ? parseDay(startStr) : null
      if (!due && !start) return null
      const s = start ?? due!
      const e = due ?? start!
      const lo = s <= e ? s : e
      const hi = s <= e ? e : s
      // La tarea entra si su intervalo [lo,hi] intersecta [from,to].
      if (from && hi < from) return null
      if (to && lo > to) return null
      return { task: t, start: lo, end: hi }
    }).filter((x): x is DatedTask => x != null)
  }, [visibleTasks, overrides, dateFrom, dateTo])

  // Cuando hay filtro de fechas activo, las tareas sin fecha no aplican.
  const undated = useMemo(() => {
    if (dateFilterActive) return []
    return visibleTasks.filter(t => {
      const ov = overrides[t.id]
      return !(ov?.due_date ?? t.due_date) && !(ov?.start_date ?? t.start_date)
    })
  }, [visibleTasks, overrides, dateFilterActive])

  const gridStart = useMemo(() => addDays(anchor, -mondayIndex(anchor)), [anchor])
  const totalDays = cfg.rangeDays
  const gridEnd = useMemo(() => addDays(gridStart, totalDays - 1), [gridStart, totalDays])

  interface Col { date: Date; dayOffset: number; span: number }
  const columns = useMemo<Col[]>(() => {
    const cols: Col[] = []
    if (cfg.unit === 'day') {
      for (let i = 0; i < totalDays; i++) {
        cols.push({ date: addDays(gridStart, i), dayOffset: i, span: 1 })
      }
    } else {
      for (let i = 0; i < totalDays; i += 7) {
        cols.push({ date: addDays(gridStart, i), dayOffset: i, span: 7 })
      }
    }
    return cols
  }, [cfg.unit, gridStart, totalDays])

  const gridWidth = totalDays * pxPerDay

  // Fondo del cuerpo: lineas verticales por columna y, en vista dia, un tinte
  // sutil en el fin de semana. gridStart siempre cae en lunes, asi que los
  // indices 5 y 6 del ciclo de 7 dias son sabado y domingo. Se pinta con
  // gradientes repetidos (van SIEMPRE por debajo del contenido, sin tapar las
  // barras). El paso de la rejilla es 1 dia en vista dia, 1 columna (7 d) en
  // vista semana/mes/trimestre.
  const colStep = cfg.unit === 'day' ? pxPerDay : pxPerDay * 7
  const gridLineLayer = `repeating-linear-gradient(90deg, var(--border, #e2e8f0) 0, var(--border, #e2e8f0) 1px, transparent 1px, transparent ${colStep}px)`
  const weekendLayer = cfg.unit === 'day'
    ? `repeating-linear-gradient(90deg, transparent 0, transparent ${pxPerDay * 5}px, rgba(100,116,139,0.06) ${pxPerDay * 5}px, rgba(100,116,139,0.06) ${pxPerDay * 7}px)`
    : ''
  const bodyGridBg = weekendLayer ? `${gridLineLayer}, ${weekendLayer}` : gridLineLayer

  function barGeometry(start: Date, end: Date): { left: number; width: number; clipStart: boolean; clipEnd: boolean } | null {
    if (end < gridStart || start > gridEnd) return null
    const clampedStart = start < gridStart ? gridStart : start
    const clampedEnd = end > gridEnd ? gridEnd : end
    const startOff = daysBetween(gridStart, clampedStart)
    const endOff = daysBetween(gridStart, clampedEnd)
    const left = startOff * pxPerDay
    const width = Math.max((endOff - startOff + 1) * pxPerDay, 8)
    return { left, width, clipStart: start < gridStart, clipEnd: end > gridEnd }
  }

  // Orden configurable (inicio, entrega, prioridad, nombre) + direccion.
  const sortItems = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return (arr: DatedTask[]) => arr.slice().sort((a, b) => {
      let r = 0
      if (sortKey === 'start') r = a.start.getTime() - b.start.getTime()
      else if (sortKey === 'due') r = a.end.getTime() - b.end.getTime()
      else if (sortKey === 'priority') r = (PRIORITY_RANK[a.task.priority] ?? 5) - (PRIORITY_RANK[b.task.priority] ?? 5)
      else r = a.task.title.localeCompare(b.task.title, 'es')
      if (r === 0) r = a.start.getTime() - b.start.getTime()
      return r * dir
    })
  }, [sortKey, sortDir])

  // Agrupar por proyecto (default), por responsable, o sin agrupar (lista plana
  // cronologica). Dentro de cada grupo, el orden lo define sortItems.
  interface Group { key: string; label: string; icon: string | null; items: DatedTask[] }
  const groups = useMemo<Group[]>(() => {
    if (groupMode === 'none') {
      return dated.length === 0
        ? []
        : [{ key: '__all__', label: tr('gantt.allTasks'), icon: null, items: sortItems(dated) }]
    }
    if (groupMode === 'assignee') {
      const byAsg = new Map<string, DatedTask[]>()
      for (const d of dated) {
        const name = d.task.assignee?.display_name ?? '__none__'
        const arr = byAsg.get(name) ?? []
        arr.push(d)
        byAsg.set(name, arr)
      }
      return Array.from(byAsg.entries())
        .map(([name, items]) => ({
          key: name,
          label: name === '__none__' ? tr('gantt.noAssignee') : name,
          icon: null,
          items: sortItems(items),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, 'es'))
    }
    const byProj = new Map<string, { name: string; icon: string | null; items: DatedTask[] }>()
    for (const d of dated) {
      const p = d.task.project
      const entry = byProj.get(p.id) ?? { name: p.name, icon: p.icon, items: [] }
      entry.items.push(d)
      byProj.set(p.id, entry)
    }
    return Array.from(byProj.entries())
      .map(([key, v]) => ({ key, label: v.name, icon: v.icon, items: sortItems(v.items) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'es'))
  }, [dated, groupMode, sortItems, tr])

  // Conteo por cubo de avance, para la leyenda. Sobre TODAS las tareas con
  // fecha del filtro activo, no solo las visibles en el scroll: "5 no
  // arrancaron" deja de significar algo si depende de donde este la vista.
  const avanceCount = useMemo(() => {
    const acc: Partial<Record<ReturnType<typeof avanceDe>, number>> = {}
    for (const d of dated) {
      const a = avanceDe(d.task.status?.category, d.start, today)
      acc[a] = (acc[a] ?? 0) + 1
    }
    return acc
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dated])

  // ── Export PDF branded WLP (solo lectura; respeta filtros y orden activos) ──
  function handleExportPdf() {
    if (groups.length === 0 && undated.length === 0) {
      toast.info(tr('gantt.pdfEmpty'))
      return
    }
    const ymd = (dt: Date) =>
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const exportGroups: GanttExportGroup[] = groups.map(g => ({
      // El equipo agrupa por proyecto, responsable o sin agrupar: el label ya es
      // un nombre neutro (o "All tasks" / "Unassigned") y se usa tal cual.
      label: g.label,
      items: g.items.map(d => {
        const t = d.task
        const done = t.status?.category === 'done' || t.status?.category === 'cancelled'
        const overdue = dueBucket(t.due_date, done) === 'overdue'
        const priorityColor = PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR.none
        const color = colorBy === 'status' ? (t.status?.color ?? priorityColor) : priorityColor
        return {
          title: t.title,
          project: t.project.name,
          assignee: t.assignee?.display_name ?? null,
          priority: t.priority,
          color,
          start: ymd(d.start),
          end: ymd(d.end),
          done,
          overdue,
        }
      }),
    }))
    // El PDF SIEMPRE se genera en ingles (entregable de cara al cliente).
    exportGanttToPdf({
      documentTitle: 'Team Schedule',
      title: teamName,
      subtitle: workspaceName,
      groups: exportGroups,
      undated: undated.map(t => ({ title: t.title, project: t.project.name })),
    })
  }

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const todayOff = daysBetween(gridStart, today)
    const todayPx = todayOff * pxPerDay
    el.scrollLeft = Math.max(0, todayPx - el.clientWidth / 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom, anchor])

  function shiftRange(dir: -1 | 1) {
    setAnchor(a => addDays(a, dir * Math.round(totalDays / 2)))
  }

  const rangeLabel = `${gridStart.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} - ${gridEnd.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' })}`
  const todayOffset = daysBetween(gridStart, today)
  const todayInRange = todayOffset >= 0 && todayOffset < totalDays
  const todayLinePx = todayOffset * pxPerDay + pxPerDay / 2

  const inputCls = 'text-xs bg-background border border-border rounded-md px-2 py-1 text-foreground focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div className="px-6 py-4">
      {/* Barra superior: rango, zoom y navegacion */}
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
          {/* Colorear por: prioridad o estado */}
          <div className="inline-flex items-center rounded-md border border-border overflow-hidden" title={tr('gantt.colorByTitle')}>
            {(['priority', 'status', 'avance'] as const).map(mode => (
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
                {mode === 'priority'
                  ? tr('gantt.colorByPriority')
                  : mode === 'status'
                    ? tr('gantt.colorByStatus')
                    : tr('gantt.colorByAvance')}
              </button>
            ))}
          </div>

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

          <button
            onClick={handleExportPdf}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={tr('gantt.exportPdfTitle')}
          >
            <FileDown className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{tr('gantt.exportPdf')}</span>
          </button>
        </div>
      </div>

      {/* Barra de filtros */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={tr('gantt.searchPlaceholder')}
            className={`${inputCls} pl-7 w-52`}
          />
        </div>

        <select value={selPriority} onChange={e => setSelPriority(e.target.value)} className={inputCls}>
          <option value="all">{tr('gantt.allPriorities')}</option>
          {(['urgent', 'high', 'medium', 'low', 'none'] as const).map(p => (
            <option key={p} value={p}>{tr('priority.' + p)}</option>
          ))}
        </select>

        {assigneeOptions.length > 0 && (
          <select value={selAssignee} onChange={e => setSelAssignee(e.target.value)} className={inputCls}>
            <option value="all">{tr('gantt.allAssignees')}</option>
            {assigneeOptions.map(a => <option key={a} value={a}>{a}</option>)}
          </select>
        )}

        <button
          onClick={() => setOnlyOverdue(v => !v)}
          className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border transition-colors ${
            onlyOverdue
              ? 'border-destructive/60 bg-destructive/10 text-destructive'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
          }`}
          aria-pressed={onlyOverdue}
        >
          <AlertTriangle className="w-3.5 h-3.5" />
          {tr('gantt.onlyOverdue')}
        </button>

        {/* Ordenar por + direccion */}
        <div className="inline-flex items-center gap-1">
          <ArrowDownUp className="w-3.5 h-3.5 text-muted-foreground/70" />
          <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} className={inputCls} title={tr('gantt.sortBy')}>
            <option value="start">{tr('gantt.sortStart')}</option>
            <option value="due">{tr('gantt.sortDue')}</option>
            <option value="priority">{tr('gantt.sortPriority')}</option>
            <option value="title">{tr('gantt.sortName')}</option>
          </select>
          <button
            onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
            className="text-xs px-1.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            title={tr('gantt.sortDir')}
            aria-label={tr('gantt.sortDir')}
          >
            {sortDir === 'asc' ? '↑' : '↓'}
          </button>
        </div>

        {/* Agrupar por */}
        <div className="inline-flex items-center gap-1">
          <Layers className="w-3.5 h-3.5 text-muted-foreground/70" />
          <select value={groupMode} onChange={e => setGroupMode(e.target.value as GroupMode)} className={inputCls} title={tr('gantt.groupBy')}>
            <option value="project">{tr('gantt.groupProject')}</option>
            <option value="none">{tr('gantt.groupNone')}</option>
            <option value="assignee">{tr('gantt.groupAssignee')}</option>
          </select>
        </div>

        {/* Rango de fechas */}
        <div className="inline-flex items-center gap-1">
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className={inputCls}
            title={tr('gantt.dateFrom')}
            aria-label={tr('gantt.dateFrom')}
          />
          <span className="text-xs text-muted-foreground">{tr('gantt.rangeTo')}</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className={inputCls}
            title={tr('gantt.dateTo')}
            aria-label={tr('gantt.dateTo')}
          />
        </div>

        {anyFilter && (
          <button
            onClick={clearFilters}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-3.5 h-3.5" />
            {tr('gantt.clear')}
          </button>
        )}

        {projectOptions.length > 1 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <SlidersHorizontal className="w-3.5 h-3.5 text-muted-foreground/70" />
            {projectOptions.map(p => {
              const active = selProjects.has(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => setSelProjects(prev => {
                    const n = new Set(prev)
                    if (n.has(p.id)) n.delete(p.id); else n.add(p.id)
                    return n
                  })}
                  className={`inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full border transition-colors ${
                    active
                      ? 'border-primary bg-primary/10 text-primary font-medium'
                      : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted'
                  }`}
                  title={p.name}
                >
                  <ProjectIcon icon={p.icon} size={12} className="flex-shrink-0" />
                  <span className="max-w-[120px] truncate">{p.name}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Leyenda del semaforo de avance. Solo en ese modo: una leyenda de
          colores que no se estan usando es ruido. */}
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

      {tasks.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted text-muted-foreground mb-3">
            <GanttChartSquare className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">{tr('gantt.emptyTeam')}</h3>
          <p className="text-sm text-muted-foreground">
            {tr('gantt.emptyTeamHint')}
          </p>
        </div>
      ) : groups.length === 0 && undated.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted text-muted-foreground mb-3">
            <Search className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">{tr('gantt.emptyFilters')}</h3>
          <button onClick={clearFilters} className="text-sm text-primary hover:underline">{tr('gantt.clearFilters')}</button>
        </div>
      ) : (
        <div className="rounded-lg border border-border overflow-hidden bg-background">
          <div ref={scrollRef} className="overflow-x-auto">
            <div style={{ width: LEFT_WIDTH + gridWidth }}>
              {/* Encabezado de fechas */}
              <div className="flex sticky top-0 z-20 bg-background border-b border-border">
                <div
                  className="sticky left-0 z-30 bg-background border-r border-border flex items-center px-3 text-[11px] font-medium text-muted-foreground"
                  style={{ width: LEFT_WIDTH, minWidth: LEFT_WIDTH }}
                >
                  {tr('gantt.projectTask')}
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

              {/* Cuerpo: un grupo por proyecto, una fila por tarea */}
              <div className="relative">
                {/* Rejilla de columnas + tinte de fin de semana (z-0, detras de todo) */}
                <div
                  className="absolute top-0 bottom-0 z-0 pointer-events-none"
                  style={{ left: LEFT_WIDTH, width: gridWidth, background: bodyGridBg }}
                />

                {todayInRange && (
                  <div
                    className="absolute top-0 bottom-0 w-px bg-primary/60 z-10 pointer-events-none"
                    style={{ left: LEFT_WIDTH + todayLinePx }}
                  >
                    <span className="absolute -top-0.5 -left-[3px] w-[7px] h-[7px] rounded-full bg-primary" />
                  </div>
                )}

                <div className="relative z-[1]">
                {groups.map(group => {
                  const isCollapsed = collapsed[group.key]
                  return (
                    <div key={group.key}>
                      <button
                        onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}
                        className="flex items-center gap-1.5 w-full sticky left-0 z-[15] bg-muted/40 hover:bg-muted/70 border-y border-border px-3 py-1.5 text-[11px] font-semibold text-foreground transition-colors"
                        style={{ width: LEFT_WIDTH + gridWidth }}
                      >
                        {isCollapsed
                          ? <ChevronRightSmall className="w-3.5 h-3.5 text-muted-foreground" />
                          : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
                        <ProjectIcon icon={group.icon} size={13} className="text-muted-foreground flex-shrink-0" />
                        <span className="sticky left-8 truncate">{group.label}</span>
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
                        const baseColor = colorBy === 'avance'
                          ? AVANCE_COLOR[avance]
                          : colorBy === 'status'
                            ? (t.status?.color ?? priorityColor)
                            : priorityColor
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
                            <div
                              className="sticky left-0 z-[5] bg-background group-hover:bg-muted/30 border-r border-border flex items-center gap-2 px-3 transition-colors"
                              style={{ width: LEFT_WIDTH, minWidth: LEFT_WIDTH }}
                            >
                              <span
                                className="w-2 h-2 rounded-full flex-shrink-0"
                                style={{ backgroundColor: t.status?.color ?? baseColor }}
                              />
                              <button
                                onClick={() => openTask(t)}
                                title={t.title}
                                className={`text-xs truncate flex-1 text-left ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                              >
                                {t.title}
                              </button>
                              <button
                                onClick={() => requestDelete(t)}
                                title={tr('gantt.deleteTask')}
                                className="flex-shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
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
                            </div>

                            <div className="relative" style={{ width: gridWidth }}>
                              {geom && (
                                <div
                                  className={`absolute top-1/2 -translate-y-1/2 h-[20px] group/bar select-none ${isDragging ? 'z-20' : ''}`}
                                  style={{ left: geom.left + 1, width: geom.width - 2 }}
                                >
                                  <div
                                    onPointerDown={e => startDrag(e, { task: t, start: effStart, end: effEnd }, 'move')}
                                    onMouseEnter={e => !dragSession.current && setHover({ task: t, start: effStart, end: effEnd, x: e.clientX, y: e.clientY })}
                                    onMouseMove={e => !dragSession.current && setHover({ task: t, start: effStart, end: effEnd, x: e.clientX, y: e.clientY })}
                                    onMouseLeave={() => setHover(null)}
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
                                      onPointerDown={e => startDrag(e, { task: t, start: effStart, end: effEnd }, 'start')}
                                      className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l opacity-0 group-hover/bar:opacity-100 transition-opacity"
                                      style={{ backgroundColor: baseColor }}
                                    />
                                  )}
                                  {/* Manija derecha (cambia fin) */}
                                  {!geom.clipEnd && (
                                    <div
                                      onPointerDown={e => startDrag(e, { task: t, start: effStart, end: effEnd }, 'end')}
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
          </div>

          {/* Bandeja "Sin fechas" */}
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
                      <div
                        key={t.id}
                        className="group/chip inline-flex items-center gap-1.5 max-w-[240px] pl-2 pr-1 py-1 rounded border border-border bg-background text-xs hover:bg-muted transition-colors"
                      >
                        <span
                          className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: t.status?.color ?? PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR.none }}
                        />
                        <button
                          onClick={() => openTask(t)}
                          title={`${t.project.name}: ${t.title}`}
                          className={`truncate ${done ? 'text-muted-foreground line-through' : 'text-foreground'}`}
                        >
                          {t.title}
                        </button>
                        <button
                          onClick={() => requestDelete(t)}
                          title={tr('gantt.deleteTask')}
                          className="flex-shrink-0 p-0.5 rounded text-muted-foreground opacity-0 group-hover/chip:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Etiqueta flotante de fechas mientras se arrastra */}
      {drag && drag.moved && (
        <div
          className="fixed z-50 pointer-events-none px-2 py-1 rounded-md bg-foreground text-background text-[11px] font-medium shadow-lg tabular-nums"
          style={{ left: drag.x + 14, top: drag.y + 14 }}
        >
          {fmtDay(drag.start, locale)} {tr('gantt.rangeTo')} {fmtDay(drag.end, locale)}
          <span className="ml-1 opacity-70">({daysBetween(drag.start, drag.end) + 1}{tr('gantt.days')})</span>
        </div>
      )}

      {/* Tooltip de detalle al pasar el cursor */}
      {hover && !drag && (
        <div
          className="fixed z-50 pointer-events-none w-64 rounded-lg border border-border bg-popover shadow-xl p-3"
          style={{
            left: Math.min(hover.x + 16, (typeof window !== 'undefined' ? window.innerWidth : 9999) - 272),
            top: hover.y + 16,
          }}
        >
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
            <ProjectIcon icon={hover.task.project.icon} size={12} className="flex-shrink-0" />
            <span className="truncate">{hover.task.project.name}</span>
          </div>
          <p className="text-sm font-medium text-foreground leading-snug mb-2 line-clamp-3">{hover.task.title}</p>
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <span
              className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
              style={{
                backgroundColor: `${PRIORITY_COLOR[hover.task.priority] ?? PRIORITY_COLOR.none}22`,
                color: PRIORITY_COLOR[hover.task.priority] ?? PRIORITY_COLOR.none,
              }}
            >
              {tr('priority.' + hover.task.priority)}
            </span>
            {hover.task.status && (
              <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                style={{
                  backgroundColor: `${hover.task.status.color ?? '#94a3b8'}22`,
                  color: hover.task.status.color ?? '#94a3b8',
                }}
              >
                {tr('status.' + hover.task.status.category)}
              </span>
            )}
          </div>
          {hover.task.assignee?.display_name && (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1.5">
              {hover.task.assignee.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hover.task.assignee.avatar_url} alt="" className="w-4 h-4 rounded-full object-cover" />
              ) : (
                <span className="w-4 h-4 rounded-full bg-muted text-[8px] flex items-center justify-center">
                  {hover.task.assignee.display_name.trim().slice(0, 2).toUpperCase()}
                </span>
              )}
              <span className="truncate">{hover.task.assignee.display_name}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-foreground/80 tabular-nums">
            <CalendarClock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
            <span>{fmtDay(hover.start, locale)} {tr('gantt.rangeTo')} {fmtDay(hover.end, locale)}</span>
            <span className="text-muted-foreground">({daysBetween(hover.start, hover.end) + 1}{tr('gantt.days')})</span>
          </div>
        </div>
      )}

      {/* Modal de borrado con doble confirmacion */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { if (!deleting) setPendingDelete(null) }}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-popover shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div
                className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: deleteStage === 1 ? '#f59e0b22' : '#ef444422',
                  color: deleteStage === 1 ? '#f59e0b' : '#ef4444',
                }}
              >
                {deleteStage === 1 ? <Trash2 className="w-4.5 h-4.5" /> : <AlertTriangle className="w-4.5 h-4.5" />}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {deleteStage === 1 ? tr('delete.q1') : tr('delete.q2')}
                </h3>
                <p className="mt-0.5 text-sm text-muted-foreground leading-snug line-clamp-2">
                  {pendingDelete.title}
                </p>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  {deleteStage === 1 ? tr('delete.body1') : tr('delete.body2')}
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              {deleteStage === 1 ? (
                <button
                  type="button"
                  onClick={() => setPendingDelete(null)}
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  {tr('delete.cancel')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => setDeleteStage(1)}
                  className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {tr('delete.back')}
                </button>
              )}
              <button
                type="button"
                disabled={deleting}
                onClick={advanceDelete}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white transition-colors disabled:opacity-60"
                style={{ backgroundColor: deleteStage === 1 ? '#f59e0b' : '#ef4444' }}
              >
                {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {deleteStage === 1 ? tr('delete.continue') : tr('delete.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

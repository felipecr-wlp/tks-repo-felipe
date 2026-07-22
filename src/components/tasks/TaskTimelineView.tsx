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
 * calendario). Interaccion de solo lectura: no hay arrastrar para reprogramar.
 */
import { useState, useMemo, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightSmall,
  GanttChartSquare, CalendarClock, AlertTriangle, CalendarOff,
} from 'lucide-react'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { TaskDetailPanel } from './TaskDetailPanel'

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
const CATEGORY_LABEL: Record<string, string> = {
  todo: 'Por hacer', in_progress: 'En progreso',
  done: 'Completadas', cancelled: 'Canceladas',
}

// Niveles de zoom. "Semana" y "Mes" usan columnas por dia (distinto ancho);
// "Trimestre" agrupa en columnas por semana para que quepa el rango largo.
type Zoom = 'semana' | 'mes' | 'trimestre'
const ZOOM_CONFIG: Record<Zoom, { label: string; unit: 'day' | 'week'; colWidth: number; rangeDays: number }> = {
  semana:    { label: 'Semana',    unit: 'day',  colWidth: 44, rangeDays: 14 },
  mes:       { label: 'Mes',       unit: 'day',  colWidth: 26, rangeDays: 42 },
  trimestre: { label: 'Trimestre', unit: 'week', colWidth: 30, rangeDays: 98 },
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

interface DatedTask { task: Task; start: Date; end: Date }

export function TaskTimelineView({ projectId, tasks, statuses, members, currentUserId }: TaskTimelineViewProps) {
  const router = useRouter()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [zoom, setZoom] = useState<Zoom>('mes')
  // Ancla del rango visible: inicio del periodo. Arranca en HOY menos un margen.
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()))
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [showUndated, setShowUndated] = useState(false)
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

  // Rango de tarea: [start, end] en dias. Requiere al menos una de las fechas.
  const dated = useMemo<DatedTask[]>(() => tasks.map(t => {
    const due = t.due_date ? parseDay(t.due_date) : null
    const start = t.start_date ? parseDay(t.start_date) : null
    if (!due && !start) return null
    const s = start ?? due!
    const e = due ?? start!
    return { task: t, start: s <= e ? s : e, end: s <= e ? e : s }
  }).filter((x): x is DatedTask => x != null), [tasks])

  const undated = useMemo(() => tasks.filter(t => !t.due_date && !t.start_date), [tasks])

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
  function barGeometry(d: DatedTask): { left: number; width: number; clipStart: boolean; clipEnd: boolean } | null {
    if (d.end < gridStart || d.start > gridEnd) return null // fuera del rango
    const clampedStart = d.start < gridStart ? gridStart : d.start
    const clampedEnd = d.end > gridEnd ? gridEnd : d.end
    const startOff = daysBetween(gridStart, clampedStart)
    const endOff = daysBetween(gridStart, clampedEnd)
    const left = startOff * pxPerDay
    const width = Math.max((endOff - startOff + 1) * pxPerDay, 8)
    return { left, width, clipStart: d.start < gridStart, clipEnd: d.end > gridEnd }
  }

  // Agrupar tareas con fecha por categoria de estado, ordenadas por inicio.
  interface Group { key: string; label: string; items: DatedTask[] }
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
        label: CATEGORY_LABEL[key] ?? key,
        items: items.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime()),
      }))
      .sort((a, b) => (CATEGORY_ORDER[a.key] ?? 99) - (CATEGORY_ORDER[b.key] ?? 99))
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

  const rangeLabel = `${gridStart.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })} - ${gridEnd.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' })}`
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
        </div>

        <div className="flex items-center gap-2">
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
                {ZOOM_CONFIG[z].label}
              </button>
            ))}
          </div>

          {/* Navegacion del rango */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => shiftRange(-1)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Rango anterior"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setAnchor(startOfDay(new Date()))}
              className="text-xs px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              Hoy
            </button>
            <button
              onClick={() => shiftRange(1)}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Rango siguiente"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-border p-10 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted text-muted-foreground mb-3">
            <GanttChartSquare className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">Sin tareas en el cronograma</h3>
          <p className="text-sm text-muted-foreground">
            Crea tareas con fecha de inicio o de vencimiento desde la vista Lista o Tablero y aparecerán aquí.
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
                  Tarea
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
                                {col.date.toLocaleDateString('es-MX', { weekday: 'narrow' })}
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
                              {col.date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
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
                        <span className="sticky left-8">{group.label}</span>
                        <span className="text-muted-foreground font-normal tabular-nums">{group.items.length}</span>
                      </button>

                      {!isCollapsed && group.items.map(d => {
                        const t = d.task
                        const done = t.status?.category === 'done' || t.status?.category === 'cancelled'
                        const bucket = dueBucket(t.due_date, done)
                        const baseColor = PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR.none
                        const geom = barGeometry(d)
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
                                <button
                                  onClick={() => setSelectedTaskId(t.id)}
                                  title={t.title}
                                  className={`absolute top-1/2 -translate-y-1/2 h-[20px] flex items-center gap-1 px-1.5 rounded text-[11px] font-medium hover:brightness-110 hover:ring-1 hover:ring-foreground/20 hover:shadow-sm transition-all ${
                                    bucket === 'overdue' ? 'ring-1 ring-destructive/70' : ''
                                  }`}
                                  style={{
                                    left: geom.left + 1,
                                    width: geom.width - 2,
                                    backgroundColor: done
                                      ? 'transparent'
                                      : `${baseColor}22`,
                                    color: done ? undefined : baseColor,
                                    borderLeft: geom.clipStart ? undefined : `2px solid ${baseColor}`,
                                    borderRight: geom.clipEnd ? `2px solid ${baseColor}` : undefined,
                                    // Completadas/canceladas con patron rayado tenue.
                                    backgroundImage: done
                                      ? 'repeating-linear-gradient(45deg, var(--muted, #64748b22) 0, var(--muted, #64748b22) 4px, transparent 4px, transparent 8px)'
                                      : undefined,
                                  }}
                                >
                                  {bucket === 'overdue' && <AlertTriangle className="w-3 h-3 flex-shrink-0" />}
                                  {bucket === 'today' && <CalendarClock className="w-3 h-3 flex-shrink-0" />}
                                  <span className={`truncate ${done ? 'text-muted-foreground line-through' : ''}`}>
                                    {t.title}
                                  </span>
                                </button>
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
                <span>Sin fechas</span>
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
    </div>
  )
}

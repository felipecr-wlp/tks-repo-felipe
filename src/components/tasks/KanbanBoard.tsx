'use client'

/**
 * Tablero Kanban, columnas por estado, drag & drop con @dnd-kit.
 * Se carga lazy desde la página del proyecto cuando view=board.
 */
import { useState, useEffect, useRef, useDeferredValue } from 'react'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  closestCorners,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { generateKeyBetween } from 'fractional-indexing'
import { toast } from 'sonner'
import { CalendarDays, ChevronLeft, ChevronRight, Filter, X, Search, ListChecks, Repeat, CheckCircle2, AlertTriangle, CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TaskDetailPanel } from './TaskDetailPanel'
import { CreateTaskInline } from './CreateTaskInline'
import { LabelChips } from './TaskLabels'
import { StackedAvatars } from './StackedAvatars'

interface Status {
  id: string
  name: string
  color: string | null
  category: string
  position: number
}

interface Task {
  id: string
  title: string
  priority: string
  due_date: string | null
  sort_order: string
  status: { id: string; name: string; color: string | null; category: string } | null
  assignee: { id: string; display_name: string; avatar_url: string | null } | null
  assignees?: { id: string; display_name: string | null; avatar_url: string | null }[]
  labels?: { id: string; name: string; color: string }[]
  subtaskTotal?: number
  subtaskDone?: number
  recurrence_rule?: string | null
}

interface Member {
  id: string
  display_name: string
  avatar_url: string | null
}

interface KanbanBoardProps {
  projectId: string
  tasks: Task[]
  statuses: Status[]
  members: Member[]
  currentUserId: string
  /** Si viene (deep-link desde inbox), abre el panel de esa tarea al montar. */
  initialTaskId?: string
}

// Metadatos de prioridad: color del acento (borde izquierdo) + punto + etiqueta.
const PRIORITY_META: Record<string, { border: string; dot: string; label: string }> = {
  urgent: { border: 'border-l-red-500',    dot: 'bg-red-500',    label: 'Urgente' },
  high:   { border: 'border-l-orange-500', dot: 'bg-orange-500', label: 'Alta' },
  medium: { border: 'border-l-yellow-400', dot: 'bg-yellow-400', label: 'Media' },
  low:    { border: 'border-l-blue-400',   dot: 'bg-blue-400',   label: 'Baja' },
  none:   { border: 'border-l-transparent', dot: 'bg-muted-foreground/30', label: '' },
}

function priorityMeta(priority: string) {
  return PRIORITY_META[priority] ?? PRIORITY_META.none
}

// Clasifica la fecha de vencimiento relativa a HOY (medianoche local). Parseamos el
// 'YYYY-MM-DD' como fecha local (no UTC) para no correrla un dia por zona horaria.
type DueBucket = 'overdue' | 'today' | 'future'
function dueBucket(due: string | null | undefined, isDone: boolean): DueBucket | null {
  if (!due || isDone) return null
  const d = new Date(String(due).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 1)
  if (d < start) return 'overdue'
  if (d < end) return 'today'
  return 'future'
}

// ─── Tarjeta Kanban ───────────────────────────────────────────────────────────
function KanbanCard({
  task,
  onOpen,
}: {
  task: Task
  onOpen: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    data: { task },
  })

  const meta = priorityMeta(task.priority)
  const isDone = task.status?.category === 'done'
  const bucket = dueBucket(task.due_date, isDone)
  const overdue = bucket === 'overdue'
  const dueToday = bucket === 'today'

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={cn(
        'bg-card border border-border rounded-lg p-3 cursor-pointer shadow-sm',
        'border-l-4 select-none transition-all duration-150',
        'hover:shadow-md hover:-translate-y-0.5 hover:border-border/80',
        meta.border,
        isDragging && 'opacity-40 shadow-lg ring-2 ring-ring'
      )}
    >
      <p className={cn(
        'text-sm font-medium leading-snug',
        isDone ? 'line-through text-muted-foreground' : 'text-foreground'
      )}>
        {task.title}
      </p>

      {task.labels && task.labels.length > 0 && (
        <LabelChips labels={task.labels} className="mt-1.5" />
      )}

      <div className="flex items-center gap-2 mt-2.5">
        {/* Prioridad: punto + etiqueta */}
        {task.priority !== 'none' && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <span className={cn('w-1.5 h-1.5 rounded-full', meta.dot)} />
            {meta.label}
          </span>
        )}

        {/* Fecha */}
        {task.due_date && (
          <span className={cn(
            'flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded',
            overdue
              ? 'bg-destructive/10 text-destructive font-medium'
              : dueToday
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium'
                : 'text-muted-foreground'
          )}>
            <CalendarDays className="w-3 h-3" />
            {dueToday
              ? 'Hoy'
              : new Date(String(task.due_date).slice(0, 10) + 'T00:00:00').toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
          </span>
        )}

        {/* Progreso de subtareas */}
        {typeof task.subtaskTotal === 'number' && task.subtaskTotal > 0 && (
          <span
            title={`${task.subtaskDone ?? 0} de ${task.subtaskTotal} subtareas completadas`}
            className={cn(
              'flex items-center gap-1 text-[11px]',
              (task.subtaskDone ?? 0) === task.subtaskTotal
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-muted-foreground'
            )}
          >
            <ListChecks className="w-3 h-3" />
            {task.subtaskDone ?? 0}/{task.subtaskTotal}
          </span>
        )}

        {/* Tarea recurrente */}
        {task.recurrence_rule && (
          <span
            title="Tarea recurrente"
            className="flex items-center gap-1 text-[11px] text-muted-foreground"
          >
            <Repeat className="w-3 h-3" />
          </span>
        )}

        {/* Avatares de los asignados (apilados si hay varios) */}
        {task.assignees && task.assignees.length > 0 ? (
          <StackedAvatars assignees={task.assignees} className="ml-auto" />
        ) : task.assignee ? (
          <div
            title={task.assignee.display_name}
            className="ml-auto w-5 h-5 rounded-full bg-muted overflow-hidden flex items-center justify-center text-[9px] font-medium text-muted-foreground ring-1 ring-border"
          >
            {task.assignee.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={task.assignee.avatar_url} alt={task.assignee.display_name} className="w-full h-full object-cover" />
            ) : (
              task.assignee.display_name.charAt(0).toUpperCase()
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}

// ─── Columna Kanban ───────────────────────────────────────────────────────────
function KanbanColumn({
  status,
  tasks,
  projectId,
  collapsed,
  onToggleCollapse,
  onOpen,
  onCreated,
}: {
  status: Status
  tasks: Task[]
  projectId: string
  collapsed: boolean
  onToggleCollapse: () => void
  onOpen: (id: string) => void
  onCreated: (task: Task) => void
}) {
  // Droppable a nivel columna: permite soltar en columnas VACIAS (antes imposible,
  // porque sin este registro no habia `over` para el status id).
  const { setNodeRef, isOver } = useDroppable({ id: status.id, data: { statusId: status.id } })
  const dot = status.color ?? '#94a3b8'
  const isDone = status.category === 'done'

  // Columna colapsada: barra vertical angosta con el nombre rotado.
  if (collapsed) {
    return (
      <div className="flex flex-col w-11 flex-shrink-0">
        <button
          onClick={onToggleCollapse}
          title={`Expandir ${status.name}`}
          aria-label={`Expandir columna ${status.name}, ${tasks.length} tareas`}
          className="flex flex-col items-center gap-2 h-full bg-muted/30 hover:bg-muted/50 rounded-xl py-3 transition-colors"
        >
          <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
          <span className="text-xs font-medium text-muted-foreground tabular-nums">{tasks.length}</span>
          <span
            className="text-xs font-medium text-foreground mt-1 whitespace-nowrap"
            style={{ writingMode: 'vertical-rl' }}
          >
            {status.name}
          </span>
          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground mt-auto" />
        </button>
      </div>
    )
  }

  return (
    <section
      aria-label={`${status.name}, ${tasks.length} tareas`}
      className="flex flex-col w-[82vw] max-w-[18rem] sm:w-72 flex-shrink-0 snap-start"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-1 mb-3 group/head">
        <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
        <span className={cn('text-sm font-semibold', isDone ? 'text-muted-foreground' : 'text-foreground')}>
          {status.name}
        </span>
        <span aria-hidden="true" className="text-[11px] font-medium text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 tabular-nums min-w-[20px] text-center">
          {tasks.length}
        </span>
        <button
          onClick={onToggleCollapse}
          title={`Colapsar ${status.name}`}
          aria-label={`Colapsar columna ${status.name}`}
          className="ml-auto p-1 rounded text-muted-foreground opacity-0 group-hover/head:opacity-100 hover:bg-muted hover:text-foreground transition-all"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Cards */}
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 rounded-xl p-2 space-y-2 min-h-[120px] transition-colors',
          'border-2 border-transparent',
          isOver ? 'bg-primary/[0.06] border-primary/30 border-dashed' : 'bg-muted/20'
        )}
      >
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <KanbanCard key={task.id} task={task} onOpen={() => onOpen(task.id)} />
          ))}
        </SortableContext>

        {/* Placeholder cuando la columna esta vacia */}
        {tasks.length === 0 && (
          <div className={cn(
            'flex items-center justify-center rounded-lg border border-dashed border-border py-8 px-3 text-center',
            isOver && 'border-primary/40'
          )}>
            <p className="text-[11px] text-muted-foreground leading-snug">
              {isDone ? 'Nada aquí todavía' : 'Suelta una tarea aquí o créala abajo'}
            </p>
          </div>
        )}

        {/* Crear tarea inline */}
        {status.category !== 'done' && (
          <div className="pt-1">
            <CreateTaskInline
              projectId={projectId}
              statusId={status.id}
              onCreated={onCreated}
            />
          </div>
        )}
      </div>
    </section>
  )
}

// ─── Board principal ──────────────────────────────────────────────────────────
export function KanbanBoard({
  projectId,
  tasks: initialTasks,
  statuses,
  members,
  currentUserId,
  initialTaskId,
}: KanbanBoardProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [priorityFilter, setPriorityFilter] = useState<Set<string>>(new Set())
  const [assigneeFilter, setAssigneeFilter] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Colaboración en vivo: al cambiar tareas/estados otro usuario, el server
  // component re-renderiza y este efecto sincroniza la copia local del tablero.
  useRealtimeRefresh({
    channel: `proj-tasks-${projectId}`,
    tables: [
      { table: 'tasks',         filter: `project_id=eq.${projectId}` },
      { table: 'task_statuses', filter: `project_id=eq.${projectId}` },
    ],
  })
  useEffect(() => { setTasks(initialTasks) }, [initialTasks])

  // Atajos de teclado: "/" enfoca la búsqueda (patrón de apps premium tipo Linear).
  // Se ignora si el foco ya está en un campo de texto o si un modal está abierto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing || selectedTaskId) return
      e.preventDefault()
      searchRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedTaskId])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // Filtros client-side: prioridad y asignado. Vacío = mostrar todo.
  // useDeferredValue difiere el recálculo del filtrado: el input responde al
  // instante en cada tecla y React procesa el filtro sin bloquear el tecleo.
  const deferredSearch = useDeferredValue(search)
  const q = deferredSearch.trim().toLowerCase()
  const filtersActive = priorityFilter.size > 0 || assigneeFilter.size > 0 || q.length > 0
  const visibleTasks = tasks.filter(t => {
    if (priorityFilter.size > 0 && !priorityFilter.has(t.priority)) return false
    if (assigneeFilter.size > 0 && !assigneeFilter.has(t.assignee?.id ?? '__none__')) return false
    if (q && !t.title.toLowerCase().includes(q)) return false
    return true
  })

  // Agrupar tareas (ya filtradas) por columna, ordenadas por sort_order para que
  // el reordenamiento optimista se refleje visualmente al instante.
  const byOrder = (a: Task, b: Task) => (a.sort_order < b.sort_order ? -1 : a.sort_order > b.sort_order ? 1 : 0)
  const tasksByStatus = statuses.reduce<Record<string, Task[]>>((acc, s) => {
    acc[s.id] = visibleTasks.filter(t => t.status?.id === s.id).sort(byOrder)
    return acc
  }, {})

  const toggleCollapse = (statusId: string) => {
    setCollapsed(prev => {
      const next = new Set(prev)
      if (next.has(statusId)) next.delete(statusId)
      else next.add(statusId)
      return next
    })
  }

  const togglePriority = (p: string) => {
    setPriorityFilter(prev => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  }

  const toggleAssignee = (id: string) => {
    setAssigneeFilter(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearFilters = () => {
    setPriorityFilter(new Set())
    setAssigneeFilter(new Set())
    setSearch('')
  }

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id)
    if (task) setActiveTask(task)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    const taskId = String(active.id)
    const moved = tasks.find(t => t.id === taskId)
    if (!moved) return

    // 'over' puede ser una tarjeta o una columna (incluida una columna vacía).
    const overId = String(over.id)
    const overIsColumn = statuses.some(s => s.id === overId)
    const overTask = tasks.find(t => t.id === overId)
    const targetStatusId = overIsColumn
      ? overId
      : (overTask?.status?.id ?? moved.status?.id ?? null)
    if (!targetStatusId) return

    // Lista COMPLETA de la columna destino (sin la tarea que se mueve), ordenada.
    // Se usa la lista completa, no la filtrada, para que el sort_order sea coherente
    // aunque haya filtros activos ocultando vecinos.
    const colTasks = tasks
      .filter(t => t.status?.id === targetStatusId && t.id !== taskId)
      .sort(byOrder)

    // Determinar los vecinos entre los que cae la tarea.
    let before: string | null
    let after: string | null
    if (!overIsColumn && overTask && overTask.id !== taskId) {
      const idx = colTasks.findIndex(t => t.id === overTask.id)
      if (idx === -1) {
        before = colTasks[colTasks.length - 1]?.sort_order ?? null
        after = null
      } else {
        // Insertar justo antes de la tarjeta sobre la que se soltó.
        before = colTasks[idx - 1]?.sort_order ?? null
        after = colTasks[idx]?.sort_order ?? null
      }
    } else {
      // Soltar en la columna (vacía o su área): al final.
      before = colTasks[colTasks.length - 1]?.sort_order ?? null
      after = null
    }

    let newKey: string
    try {
      newKey = generateKeyBetween(before, after)
    } catch {
      return // orden inconsistente; no mover
    }

    const sameColumn = moved.status?.id === targetStatusId
    // Si no cambió de columna y la clave nueva es igual a la actual, no hay nada que hacer.
    if (sameColumn && newKey === moved.sort_order) return

    const newStatus = statuses.find(s => s.id === targetStatusId) ?? moved.status
    const prevStatus = moved.status
    const prevSort = moved.sort_order

    // Optimistic update
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, status: newStatus, sort_order: newKey } : t
    ))

    // Persistir: siempre sort_order; status_id solo si cambió de columna.
    try {
      const payload: Record<string, unknown> = { sort_order: newKey }
      if (!sameColumn) payload.status_id = targetStatusId
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) throw new Error('Error al mover la tarea')
    } catch {
      toast.error('Error al mover la tarea')
      // Revertir SOLO la tarea movida a su posición previa. Antes se restauraba
      // initialTasks completo, lo que pisaba cambios locales posteriores
      // (tareas creadas o editadas después del último render del servidor).
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, status: prevStatus, sort_order: prevSort } : t
      ))
    }
  }

  // Salud del proyecto (sobre TODAS las tareas, no las filtradas): completado,
  // vencidas y para hoy. Da una lectura de un vistazo arriba del tablero.
  const total = tasks.length
  const doneCount = tasks.filter(t => t.status?.category === 'done').length
  const overdueCount = tasks.filter(t => dueBucket(t.due_date, t.status?.category === 'done') === 'overdue').length
  const todayCount = tasks.filter(t => dueBucket(t.due_date, t.status?.category === 'done') === 'today').length
  const donePct = total === 0 ? 0 : Math.round((doneCount / total) * 100)

  const handleTaskCreated = (newTask: Task) => {
    setTasks(prev => [...prev, newTask])
  }

  const handleTaskUpdated = (updated: Task) => {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Panel de detalle (overlay fixed, no afecta el layout del tablero) */}
      {selectedTaskId && (
        <TaskDetailPanel
          taskId={selectedTaskId}
          statuses={statuses}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={handleTaskUpdated}
          onDeleted={(id) => { setTasks(prev => prev.filter(t => t.id !== id)); setSelectedTaskId(null) }}
          onOpenTask={setSelectedTaskId}
        />
      )}

      {/* Barra de filtros */}
      <div className="flex items-center gap-3 px-3 sm:px-6 pt-4 pb-1 flex-wrap">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Filter className="w-3.5 h-3.5" /> Filtrar
        </span>

        {/* Búsqueda por título */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur() } }}
            placeholder="Buscar tarea..."
            className="w-44 pl-7 pr-7 py-1 text-[11px] rounded-md border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:w-56 transition-all"
          />
          {search ? (
            <button
              onClick={() => setSearch('')}
              title="Limpiar búsqueda"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          ) : (
            <kbd className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] font-medium text-muted-foreground border border-border rounded px-1 pointer-events-none">
              /
            </kbd>
          )}
        </div>

        {/* Prioridad */}
        <div className="flex items-center gap-1">
          {(['urgent', 'high', 'medium', 'low'] as const).map(p => {
            const m = PRIORITY_META[p]
            const active = priorityFilter.has(p)
            return (
              <button
                key={p}
                onClick={() => togglePriority(p)}
                className={cn(
                  'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors',
                  active
                    ? 'bg-foreground/[0.06] border-border text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-muted'
                )}
              >
                <span className={cn('w-1.5 h-1.5 rounded-full', m.dot)} />
                {m.label}
              </button>
            )
          })}
        </div>

        {/* Asignados */}
        {members.length > 0 && (
          <div className="flex items-center gap-1">
            {members.map(mem => {
              const active = assigneeFilter.has(mem.id)
              return (
                <button
                  key={mem.id}
                  onClick={() => toggleAssignee(mem.id)}
                  title={mem.display_name}
                  className={cn(
                    'w-6 h-6 rounded-full overflow-hidden flex items-center justify-center text-[10px] font-medium bg-muted text-muted-foreground ring-2 transition-all',
                    active ? 'ring-primary' : 'ring-transparent hover:ring-border'
                  )}
                >
                  {mem.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={mem.avatar_url} alt={mem.display_name} className="w-full h-full object-cover" />
                  ) : (
                    mem.display_name.charAt(0).toUpperCase()
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Solo mías */}
        <button
          onClick={() => toggleAssignee(currentUserId)}
          className={cn(
            'px-2 py-1 rounded-md text-[11px] font-medium border transition-colors',
            assigneeFilter.has(currentUserId)
              ? 'bg-primary/10 border-primary/30 text-primary'
              : 'border-border text-muted-foreground hover:bg-muted'
          )}
        >
          Solo mías
        </button>

        {filtersActive && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {visibleTasks.length} de {tasks.length}
            </span>
            <button
              onClick={clearFilters}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3 h-3" /> Limpiar
            </button>
          </div>
        )}
      </div>

      {/* Salud del proyecto: barra de completado + conteos clave */}
      {total > 0 && (
        <div className="flex items-center gap-x-4 gap-y-1.5 px-3 sm:px-6 pb-2.5 pt-0.5 flex-wrap">
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
              <span className="tabular-nums">{doneCount}/{total}</span> completadas
            </span>
            {overdueCount > 0 && (
              <span className="inline-flex items-center gap-1 text-destructive font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span className="tabular-nums">{overdueCount}</span> vencidas
              </span>
            )}
            {todayCount > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
                <CalendarClock className="w-3.5 h-3.5" />
                <span className="tabular-nums">{todayCount}</span> para hoy
              </span>
            )}
          </div>
        </div>
      )}

      {/* Estado vacío al filtrar: ninguna tarea coincide */}
      {filtersActive && visibleTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 py-16 px-6 text-center">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted text-muted-foreground mb-3">
            <Search className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">Sin coincidencias</h3>
          <p className="text-xs text-muted-foreground mb-4 max-w-xs">
            Ninguna tarea coincide con los filtros o la búsqueda actual.
          </p>
          <button
            onClick={clearFilters}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border border-border text-foreground hover:bg-muted transition-colors"
          >
            <X className="w-3.5 h-3.5" /> Limpiar filtros
          </button>
        </div>
      )}

      {/* Columnas */}
      {!(filtersActive && visibleTasks.length === 0) && (
      <div className="flex gap-3 sm:gap-4 px-3 sm:px-6 py-4 overflow-x-auto pb-8 flex-1 snap-x snap-mandatory sm:snap-none scroll-px-3 sm:scroll-px-6">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        {statuses.map(status => (
          <KanbanColumn
            key={status.id}
            status={status}
            tasks={tasksByStatus[status.id] ?? []}
            projectId={projectId}
            collapsed={collapsed.has(status.id)}
            onToggleCollapse={() => toggleCollapse(status.id)}
            onOpen={setSelectedTaskId}
            onCreated={handleTaskCreated}
          />
        ))}

        {/* Overlay para la tarjeta que se arrastra */}
        <DragOverlay>
          {activeTask && (() => {
            const meta = priorityMeta(activeTask.priority)
            return (
              <div className={cn(
                'bg-card border border-border rounded-lg p-3 shadow-xl border-l-4 w-72 rotate-2 cursor-grabbing',
                meta.border
              )}>
                <p className="text-sm font-medium text-foreground leading-snug">{activeTask.title}</p>
                {activeTask.priority !== 'none' && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground mt-2">
                    <span className={cn('w-1.5 h-1.5 rounded-full', meta.dot)} />
                    {meta.label}
                  </span>
                )}
              </div>
            )
          })()}
        </DragOverlay>
      </DndContext>
      </div>
      )}
    </div>
  )
}

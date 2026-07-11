'use client'

/**
 * Tablero Kanban, columnas por estado, drag & drop con @dnd-kit.
 * Se carga lazy desde la página del proyecto cuando view=board.
 */
import { useState, useEffect } from 'react'
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
import { toast } from 'sonner'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TaskDetailPanel } from './TaskDetailPanel'
import { CreateTaskInline } from './CreateTaskInline'
import { LabelChips } from './TaskLabels'

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
  labels?: { id: string; name: string; color: string }[]
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
  const overdue = !!task.due_date && new Date(task.due_date) < new Date() && !isDone

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
            overdue ? 'bg-destructive/10 text-destructive font-medium' : 'text-muted-foreground'
          )}>
            <CalendarDays className="w-3 h-3" />
            {new Date(task.due_date).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
          </span>
        )}

        {/* Avatar del asignado */}
        {task.assignee && (
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
        )}
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
          className="flex flex-col items-center gap-2 h-full bg-muted/30 hover:bg-muted/50 rounded-xl py-3 transition-colors"
        >
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
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
    <div className="flex flex-col w-72 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-1 mb-3 group/head">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: dot }} />
        <span className={cn('text-sm font-semibold', isDone ? 'text-muted-foreground' : 'text-foreground')}>
          {status.name}
        </span>
        <span className="text-[11px] font-medium text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 tabular-nums min-w-[20px] text-center">
          {tasks.length}
        </span>
        <button
          onClick={onToggleCollapse}
          title={`Colapsar ${status.name}`}
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
    </div>
  )
}

// ─── Board principal ──────────────────────────────────────────────────────────
export function KanbanBoard({
  projectId,
  tasks: initialTasks,
  statuses,
  members,
  currentUserId,
}: KanbanBoardProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [activeTask, setActiveTask] = useState<Task | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  // Colaboración en vivo: al cambiar tareas/estados otro usuario, el server
  // component re-renderiza y este efecto sincroniza la copia local del tablero.
  useRealtimeRefresh({ channel: `proj-tasks-${projectId}`, tables: ['tasks', 'task_statuses'] })
  useEffect(() => { setTasks(initialTasks) }, [initialTasks])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  )

  // Agrupar tareas por columna
  const tasksByStatus = statuses.reduce<Record<string, Task[]>>((acc, s) => {
    acc[s.id] = tasks.filter(t => t.status?.id === s.id)
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

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id)
    if (task) setActiveTask(task)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    // Determinar el nuevo status_id
    // 'over' puede ser una tarjeta o una columna (incluida una columna vacía).
    const overId = String(over.id)
    const overStatus = statuses.find(s => s.id === overId)
    const overTask = tasks.find(t => t.id === overId)
    const newStatusId = overStatus?.id ?? overTask?.status?.id ?? null

    if (!newStatusId) return

    const taskId = String(active.id)
    const currentTask = tasks.find(t => t.id === taskId)
    if (!currentTask || currentTask.status?.id === newStatusId) return

    // Optimistic update
    setTasks(prev => prev.map(t =>
      t.id === taskId
        ? { ...t, status: statuses.find(s => s.id === newStatusId) ?? t.status }
        : t
    ))

    // Persistir
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_id: newStatusId }),
      })
      if (!res.ok) throw new Error('Error al mover la tarea')
    } catch {
      toast.error('Error al mover la tarea')
      // Revertir
      setTasks(initialTasks)
    }
  }

  const handleTaskCreated = (newTask: Task) => {
    setTasks(prev => [...prev, newTask])
  }

  const handleTaskUpdated = (updated: Task) => {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
  }

  return (
    <div className="flex gap-4 px-6 py-4 overflow-x-auto pb-8 min-h-full">
      {/* Panel de detalle */}
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
  )
}

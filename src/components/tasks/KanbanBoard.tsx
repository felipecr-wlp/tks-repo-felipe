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
  closestCorners,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { toast } from 'sonner'
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

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'border-l-red-500',
  high:   'border-l-orange-500',
  medium: 'border-l-yellow-400',
  low:    'border-l-blue-400',
  none:   'border-l-transparent',
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

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      className={cn(
        'bg-card border border-border rounded-lg p-3 cursor-pointer shadow-sm',
        'border-l-4 hover:shadow-md transition-shadow select-none',
        PRIORITY_COLORS[task.priority] ?? PRIORITY_COLORS.none,
        isDragging && 'opacity-50 shadow-lg ring-2 ring-ring'
      )}
    >
      <p className={cn(
        'text-sm font-medium leading-snug',
        task.status?.category === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'
      )}>
        {task.title}
      </p>

      {task.labels && task.labels.length > 0 && (
        <LabelChips labels={task.labels} className="mt-1.5" />
      )}

      <div className="flex items-center justify-between mt-2">
        {/* Fecha */}
        {task.due_date && (
          <span className={cn(
            'text-[11px] px-1.5 py-0.5 rounded',
            new Date(task.due_date) < new Date() && task.status?.category !== 'done'
              ? 'bg-destructive/10 text-destructive'
              : 'text-muted-foreground'
          )}>
            {new Date(task.due_date).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
          </span>
        )}

        {/* Avatar del asignado */}
        {task.assignee && (
          <div className="ml-auto w-5 h-5 rounded-full bg-muted overflow-hidden flex items-center justify-center text-[9px] font-medium text-muted-foreground">
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
  onOpen,
  onCreated,
}: {
  status: Status
  tasks: Task[]
  projectId: string
  onOpen: (id: string) => void
  onCreated: (task: Task) => void
}) {
  return (
    <div className="flex flex-col w-72 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-1 mb-3">
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: status.color ?? '#94a3b8' }} />
        <span className="text-sm font-medium text-foreground">{status.name}</span>
        <span className="text-xs text-muted-foreground ml-auto">{tasks.length}</span>
      </div>

      {/* Cards */}
      <div className="flex-1 bg-muted/20 rounded-xl p-2 space-y-2 min-h-[120px]">
        <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
          {tasks.map(task => (
            <KanbanCard key={task.id} task={task} onOpen={() => onOpen(task.id)} />
          ))}
        </SortableContext>

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

  const handleDragStart = (event: DragStartEvent) => {
    const task = tasks.find(t => t.id === event.active.id)
    if (task) setActiveTask(task)
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveTask(null)
    const { active, over } = event
    if (!over || active.id === over.id) return

    // Determinar el nuevo status_id
    // 'over' puede ser una tarjeta o una columna
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
            onOpen={setSelectedTaskId}
            onCreated={handleTaskCreated}
          />
        ))}

        {/* Overlay para la tarjeta que se arrastra */}
        <DragOverlay>
          {activeTask && (
            <div className={cn(
              'bg-card border border-border rounded-lg p-3 shadow-xl border-l-4 w-72 rotate-2',
              PRIORITY_COLORS[activeTask.priority] ?? PRIORITY_COLORS.none
            )}>
              <p className="text-sm font-medium text-foreground">{activeTask.title}</p>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

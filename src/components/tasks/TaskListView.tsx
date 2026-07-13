'use client'

/**
 * Vista de lista de tareas, muestra tareas agrupadas por estado.
 * Permite crear tareas inline y cambiar estado/prioridad.
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ListTodo, Search, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { TaskRow as TaskItem } from './TaskRow'
import { CreateTaskInline } from './CreateTaskInline'
import { TaskDetailPanel } from './TaskDetailPanel'
import { BulkActionBar } from './BulkActionBar'

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
  subtaskTotal?: number
  subtaskDone?: number
  recurrence_rule?: string | null
}

interface Member {
  id: string
  display_name: string
  avatar_url: string | null
}

interface TaskListViewProps {
  projectId: string
  projectSlug: string
  workspaceSlug: string
  teamSlug: string
  tasks: Task[]
  statuses: Status[]
  members: Member[]
  currentUserId: string
  /** Si viene (deep-link desde inbox), abre el panel de esa tarea al montar. */
  initialTaskId?: string
}

export function TaskListView({
  projectId,
  statuses,
  members,
  currentUserId,
  tasks: initialTasks,
  initialTaskId,
}: TaskListViewProps) {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [search, setSearch] = useState('')
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null)

  // Colaboración en vivo: sincroniza la lista cuando otro usuario cambia tareas.
  useRealtimeRefresh({ channel: `proj-list-${projectId}`, tables: ['tasks', 'task_statuses'] })
  useEffect(() => { setTasks(initialTasks) }, [initialTasks])

  // Orden visual plano de las tareas (grupos por estado, luego sin estado) para
  // resolver la seleccion por rango con Shift.
  const orderedIds = [
    ...statuses.flatMap(s => tasks.filter(t => t.status?.id === s.id).map(t => t.id)),
    ...tasks.filter(t => !t.status).map(t => t.id),
  ]

  const toggleSelect = (taskId: string, shiftKey: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (shiftKey && lastSelectedId && lastSelectedId !== taskId) {
        // Seleccion por rango: marca todo entre la ultima y la actual.
        const a = orderedIds.indexOf(lastSelectedId)
        const b = orderedIds.indexOf(taskId)
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          for (let i = lo; i <= hi; i++) next.add(orderedIds[i])
        }
      } else if (next.has(taskId)) {
        next.delete(taskId)
      } else {
        next.add(taskId)
      }
      return next
    })
    setLastSelectedId(taskId)
  }

  const clearSelection = () => { setSelectedIds(new Set()); setLastSelectedId(null) }

  const handleBulkApplied = () => {
    clearSelection()
    router.refresh()
  }

  // Búsqueda por título (client-side, refleja el patrón del tablero).
  const q = search.trim().toLowerCase()
  const matches = (t: Task) => q === '' || t.title.toLowerCase().includes(q)
  const visibleTasks = tasks.filter(matches)

  // Agrupar tareas por estado
  const tasksByStatus = statuses.reduce<Record<string, Task[]>>((acc, status) => {
    acc[status.id] = visibleTasks.filter(t => t.status?.id === status.id)
    return acc
  }, {})

  // Tareas sin estado
  const unassigned = visibleTasks.filter(t => !t.status)

  const toggleGroup = (statusId: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(statusId)) next.delete(statusId)
      else next.add(statusId)
      return next
    })
  }

  const handleTaskCreated = (newTask: Task) => {
    setTasks(prev => [...prev, newTask])
    router.refresh()
  }

  const handleTaskUpdated = (updatedTask: Task) => {
    setTasks(prev => prev.map(t => (t.id === updatedTask.id ? updatedTask : t)))
    router.refresh()
  }

  const handleTaskDeleted = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId))
    toast.success('Tarea eliminada')
    router.refresh()
  }

  return (
    <div className="px-6 py-4">
      {/* Panel de detalle de tarea */}
      {selectedTaskId && (
        <TaskDetailPanel
          taskId={selectedTaskId}
          statuses={statuses}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={handleTaskUpdated}
          onDeleted={(id) => { handleTaskDeleted(id); setSelectedTaskId(null) }}
          onOpenTask={setSelectedTaskId}
        />
      )}
      {/* Búsqueda por título */}
      {tasks.length > 0 && (
        <div className="relative mb-4 max-w-xs">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setSearch(''); e.currentTarget.blur() } }}
            placeholder="Buscar por título..."
            className="w-full rounded-md border border-border bg-background pl-8 pr-7 py-1.5 text-sm outline-none focus:border-ring transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              title="Limpiar búsqueda"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Sin coincidencias de búsqueda */}
      {tasks.length > 0 && q !== '' && visibleTasks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-muted/20 py-12 px-6 text-center">
          <span className="flex items-center justify-center w-10 h-10 rounded-full bg-muted text-muted-foreground">
            <Search className="w-5 h-5" aria-hidden />
          </span>
          <p className="text-sm text-muted-foreground">
            Sin coincidencias para <span className="font-medium text-foreground">&ldquo;{search}&rdquo;</span>
          </p>
        </div>
      )}

      {/* Grupos de tareas por estado */}
      {(q === '' || visibleTasks.length > 0) && statuses.map(status => {
        const groupTasks = tasksByStatus[status.id] ?? []
        const isCollapsed = collapsedGroups.has(status.id)
        const isDoneCategory = status.category === 'done'

        // Durante una búsqueda activa, ocultar grupos sin coincidencias.
        if (q !== '' && groupTasks.length === 0) return null

        return (
          <div key={status.id} className="mb-6">
            {/* Header del grupo */}
            <div className="flex items-center gap-2 mb-1.5 group/header">
              <button
                onClick={() => toggleGroup(status.id)}
                className="flex items-center gap-2 text-sm font-medium hover:text-foreground transition-colors"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  className={cn('text-muted-foreground transition-transform', isCollapsed ? '-rotate-90' : '')}
                >
                  <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: status.color ?? '#94a3b8' }}
                />
                <span className="text-foreground">{status.name}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {groupTasks.length}
                </span>
              </button>
            </div>

            {/* Tareas del grupo */}
            {!isCollapsed && (
              <div className="space-y-0.5">
                {groupTasks.map(task => (
                  <TaskItem
                    key={task.id}
                    task={task}
                    statuses={statuses}
                    members={members}
                    currentUserId={currentUserId}
                    onUpdated={handleTaskUpdated}
                    onDeleted={handleTaskDeleted}
                    onOpen={() => setSelectedTaskId(task.id)}
                    selected={selectedIds.has(task.id)}
                    selectionActive={selectedIds.size > 0}
                    onToggleSelect={toggleSelect}
                  />
                ))}

                {/* Crear tarea inline (solo para estados no-done, oculto en búsqueda) */}
                {!isDoneCategory && q === '' && (
                  <CreateTaskInline
                    projectId={projectId}
                    statusId={status.id}
                    onCreated={handleTaskCreated}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}

      {/* Tareas sin estado asignado */}
      {unassigned.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-muted-foreground/30" />
            <span className="text-sm font-medium text-foreground">Sin estado</span>
            <span className="text-xs text-muted-foreground">{unassigned.length}</span>
          </div>
          <div className="space-y-0.5">
            {unassigned.map(task => (
              <TaskItem
                key={task.id}
                task={task}
                statuses={statuses}
                members={members}
                currentUserId={currentUserId}
                onUpdated={handleTaskUpdated}
                onDeleted={handleTaskDeleted}
                onOpen={() => setSelectedTaskId(task.id)}
                selected={selectedIds.has(task.id)}
                selectionActive={selectedIds.size > 0}
                onToggleSelect={toggleSelect}
              />
            ))}
          </div>
        </div>
      )}

      {/* Mensaje vacío total */}
      {tasks.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-muted/20 py-14 px-6 text-center">
          <span className="flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 text-primary">
            <ListTodo className="w-6 h-6" aria-hidden />
          </span>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              No hay tareas en este proyecto todavía
            </p>
            <p className="text-xs text-muted-foreground">
              Haz clic en &quot;+ Nueva tarea&quot; debajo de cualquier estado para comenzar.
            </p>
          </div>
        </div>
      )}

      {/* Barra flotante de acciones masivas */}
      {selectedIds.size > 0 && (
        <BulkActionBar
          projectId={projectId}
          selectedIds={Array.from(selectedIds)}
          statuses={statuses}
          members={members}
          onClear={clearSelection}
          onApplied={handleBulkApplied}
        />
      )}
    </div>
  )
}

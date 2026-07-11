'use client'

/**
 * Vista de lista de tareas, muestra tareas agrupadas por estado.
 * Permite crear tareas inline y cambiar estado/prioridad.
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ListTodo } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { TaskRow as TaskItem } from './TaskRow'
import { CreateTaskInline } from './CreateTaskInline'
import { TaskDetailPanel } from './TaskDetailPanel'

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

interface TaskListViewProps {
  projectId: string
  projectSlug: string
  workspaceSlug: string
  teamSlug: string
  tasks: Task[]
  statuses: Status[]
  members: Member[]
  currentUserId: string
}

export function TaskListView({
  projectId,
  statuses,
  members,
  currentUserId,
  tasks: initialTasks,
}: TaskListViewProps) {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set())
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)

  // Colaboración en vivo: sincroniza la lista cuando otro usuario cambia tareas.
  useRealtimeRefresh({ channel: `proj-list-${projectId}`, tables: ['tasks', 'task_statuses'] })
  useEffect(() => { setTasks(initialTasks) }, [initialTasks])

  // Agrupar tareas por estado
  const tasksByStatus = statuses.reduce<Record<string, Task[]>>((acc, status) => {
    acc[status.id] = tasks.filter(t => t.status?.id === status.id)
    return acc
  }, {})

  // Tareas sin estado
  const unassigned = tasks.filter(t => !t.status)

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
      {/* Grupos de tareas por estado */}
      {statuses.map(status => {
        const groupTasks = tasksByStatus[status.id] ?? []
        const isCollapsed = collapsedGroups.has(status.id)
        const isDoneCategory = status.category === 'done'

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
                  />
                ))}

                {/* Crear tarea inline (solo para estados no-done) */}
                {!isDoneCategory && (
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
    </div>
  )
}

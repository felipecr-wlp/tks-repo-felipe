'use client'

/**
 * Sección de subtareas REALES dentro del TaskDetailPanel.
 *
 * A diferencia del checklist ligero, cada subtarea es una tarea completa
 * (tiene estado, prioridad, asignado) enlazada al padre por `parent_task_id`.
 * Crear reutiliza POST /api/tasks con parent_task_id; el listado usa
 * GET /api/tasks/[taskId]/subtasks; el toggle de "hecha" reutiliza
 * PATCH /api/tasks/[subtaskId] moviendo el estado a una categoría done/no-done.
 *
 * Autocontenida por taskId. `onOpenTask` (opcional) permite abrir la subtarea
 * en el mismo panel; sin ese callback, el título no navega.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ListTree, Trash2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Status { id: string; name: string; color: string | null; category: string }

interface Subtask {
  id: string
  title: string
  priority: string
  due_date: string | null
  status: Status | null
  assignee: { id: string; display_name: string; avatar_url: string | null } | null
}

interface SubtasksSectionProps {
  taskId: string
  projectId: string
  statuses: Status[]
  onOpenTask?: (taskId: string) => void
}

export function SubtasksSection({ taskId, projectId, statuses, onOpenTask }: SubtasksSectionProps) {
  const [items, setItems] = useState<Subtask[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)

  const doneStatus = statuses.find(s => s.category === 'done') ?? null
  const openStatus = statuses.find(s => s.category !== 'done') ?? null

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/tasks/${taskId}/subtasks`)
      .then(r => (r.ok ? r.json() : { subtasks: [] }))
      .then(data => { if (alive) setItems(data.subtasks ?? []) })
      .catch(() => { if (alive) toast.error('Error al cargar subtareas') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [taskId])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || adding) return
    setAdding(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: projectId, parent_task_id: taskId, title: newTitle.trim() }),
      })
      if (!res.ok) throw new Error()
      const created = await res.json()
      setItems(prev => [...prev, {
        id: created.id,
        title: created.title,
        priority: created.priority,
        due_date: created.due_date ?? null,
        status: created.status ?? null,
        assignee: created.assignee ?? null,
      }])
      setNewTitle('')
    } catch {
      toast.error('Error al crear la subtarea')
    } finally {
      setAdding(false)
    }
  }

  async function handleToggle(sub: Subtask) {
    const isDone = sub.status?.category === 'done'
    const target = isDone ? openStatus : doneStatus
    if (!target) return
    const prevStatus = sub.status
    setItems(prev => prev.map(i => (i.id === sub.id ? { ...i, status: target } : i)))
    try {
      const res = await fetch(`/api/tasks/${sub.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status_id: target.id }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setItems(prev => prev.map(i => (i.id === sub.id ? { ...i, status: prevStatus } : i)))
      toast.error('Error al actualizar la subtarea')
    }
  }

  async function handleDelete(id: string) {
    const before = items
    setItems(prev => prev.filter(i => i.id !== id))
    try {
      const res = await fetch(`/api/tasks/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      setItems(before)
      toast.error('Error al eliminar la subtarea')
    }
  }

  const completed = items.filter(i => i.status?.category === 'done').length
  const total = items.length
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <ListTree className="w-3.5 h-3.5" />
          Subtareas {total > 0 && <span className="ml-0.5 normal-case tracking-normal text-muted-foreground/70">({completed}/{total})</span>}
        </p>
        {total > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-20 h-1 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums">{progress}%</span>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 text-muted-foreground animate-spin" /></div>
      ) : (
        <div className="space-y-0.5">
          {items.map(sub => {
            const isDone = sub.status?.category === 'done'
            return (
              <div key={sub.id} className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/40 transition-colors">
                <button
                  onClick={() => handleToggle(sub)}
                  disabled={!doneStatus}
                  className={cn(
                    'flex-shrink-0 w-3.5 h-3.5 rounded-[4px] border transition-colors flex items-center justify-center',
                    isDone ? 'bg-primary border-primary text-primary-foreground' : 'border-border hover:border-primary',
                    !doneStatus && 'opacity-40 cursor-not-allowed'
                  )}
                  aria-label={isDone ? 'Marcar pendiente' : 'Marcar completada'}
                  title={doneStatus ? (isDone ? 'Marcar pendiente' : 'Marcar completada') : 'Sin estado "hecho" en el proyecto'}
                >
                  {isDone && (
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                      <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>

                {sub.status && (
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: sub.status.color ?? '#94a3b8' }} />
                )}

                <button
                  onClick={() => onOpenTask?.(sub.id)}
                  disabled={!onOpenTask}
                  className={cn(
                    'flex-1 text-sm text-left truncate',
                    isDone ? 'line-through text-muted-foreground' : 'text-foreground',
                    onOpenTask ? 'hover:text-primary transition-colors cursor-pointer' : 'cursor-default'
                  )}
                  title={onOpenTask ? 'Abrir subtarea' : undefined}
                >
                  {sub.title}
                </button>

                {sub.assignee && (
                  <div className="w-5 h-5 rounded-full bg-muted overflow-hidden flex items-center justify-center text-[9px] font-medium text-muted-foreground flex-shrink-0">
                    {sub.assignee.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={sub.assignee.avatar_url} alt={sub.assignee.display_name} className="w-full h-full object-cover" />
                    ) : (
                      sub.assignee.display_name.charAt(0).toUpperCase()
                    )}
                  </div>
                )}

                <button
                  onClick={() => handleDelete(sub.id)}
                  className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-all flex-shrink-0"
                  aria-label="Eliminar subtarea"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            )
          })}

          <form onSubmit={handleAdd} className="flex items-center gap-2 px-1.5 py-1">
            <span className="w-3.5 h-3.5 rounded-[4px] border border-border flex-shrink-0" />
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="+ Agregar subtarea"
              disabled={adding}
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
            />
          </form>
        </div>
      )}
    </section>
  )
}

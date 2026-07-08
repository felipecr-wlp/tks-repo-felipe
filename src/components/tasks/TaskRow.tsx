'use client'

/**
 * Fila de tarea en la vista de lista.
 * Permite edición inline de título, estado y prioridad.
 */
import { useState, useRef } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { cn, getInitials } from '@/lib/utils'

interface Status {
  id: string
  name: string
  color: string | null
  category: string
}

interface Task {
  id: string
  title: string
  priority: string
  due_date: string | null
  sort_order: string
  status: { id: string; name: string; color: string | null; category: string } | null
  assignee: { id: string; display_name: string; avatar_url: string | null } | null
}

interface Member {
  id: string
  display_name: string
  avatar_url: string | null
}

interface TaskRowProps {
  task: Task
  statuses: Status[]
  members: Member[]
  currentUserId: string
  onUpdated: (task: Task) => void
  onDeleted: (taskId: string) => void
  onOpen?: () => void
}

const PRIORITY_ICONS: Record<string, { icon: string; label: string; color: string }> = {
  urgent: { icon: '⚡', label: 'Urgente', color: 'text-red-500' },
  high:   { icon: '↑↑', label: 'Alta',    color: 'text-orange-500' },
  medium: { icon: '↑',  label: 'Media',   color: 'text-yellow-500' },
  low:    { icon: '↓',  label: 'Baja',    color: 'text-blue-400' },
  none:   { icon: '—',  label: 'Sin prioridad', color: 'text-muted-foreground' },
}

export function TaskRow({
  task,
  statuses,
  members,
  onUpdated,
  onDeleted,
  onOpen,
}: TaskRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showPriorityMenu, setShowPriorityMenu] = useState(false)
  const [showAssignMenu, setShowAssignMenu] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Actualizar campo de la tarea ──────────────────────────────────────────
  const updateTask = async (patch: Partial<{ title: string; status_id: string; priority: string; assignee_id: string | null }>) => {
    setIsLoading(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al actualizar')
      }

      const updated: Task = await res.json()
      onUpdated(updated)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al actualizar la tarea')
    } finally {
      setIsLoading(false)
    }
  }

  const deleteTask = async () => {
    if (!confirm('¿Eliminar esta tarea?')) return
    setIsLoading(true)
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Error al eliminar')
      onDeleted(task.id)
    } catch {
      toast.error('Error al eliminar la tarea')
      setIsLoading(false)
    }
  }

  const handleTitleSave = () => {
    setIsEditing(false)
    if (title.trim() && title.trim() !== task.title) {
      updateTask({ title: title.trim() })
    } else {
      setTitle(task.title)
    }
  }

  const priority = PRIORITY_ICONS[task.priority] ?? PRIORITY_ICONS.none

  return (
    <div className={cn(
      'flex items-center gap-2 px-2 py-1.5 rounded-md group hover:bg-muted/40 transition-colors',
      isLoading && 'opacity-60 pointer-events-none'
    )}>
      {/* ── Status dot ─────────────────────────────────────── */}
      <div className="relative flex-shrink-0">
        <button
          onClick={() => { setShowStatusMenu(!showStatusMenu); setShowPriorityMenu(false); setShowAssignMenu(false) }}
          title={task.status?.name ?? 'Sin estado'}
          className="w-4 h-4 rounded-full border-2 border-current transition-transform hover:scale-110"
          style={{ borderColor: task.status?.color ?? '#94a3b8', backgroundColor: task.status?.category === 'done' ? (task.status.color ?? '#94a3b8') : 'transparent' }}
        />
        {showStatusMenu && (
          <StatusMenu
            statuses={statuses}
            currentId={task.status?.id}
            onSelect={(id) => { setShowStatusMenu(false); updateTask({ status_id: id }) }}
            onClose={() => setShowStatusMenu(false)}
          />
        )}
      </div>

      {/* ── Título ─────────────────────────────────────────── */}
      <div className="flex-1 min-w-0">
        {isEditing ? (
          <input
            ref={inputRef}
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={e => {
              if (e.key === 'Enter') handleTitleSave()
              if (e.key === 'Escape') { setIsEditing(false); setTitle(task.title) }
            }}
            className="w-full text-sm bg-transparent outline-none border-b border-ring"
            autoFocus
          />
        ) : (
          <button
            onClick={() => onOpen?.()}
            onDoubleClick={() => { setIsEditing(true); setTimeout(() => inputRef.current?.focus(), 0) }}
            className={cn(
              'text-sm text-left w-full truncate transition-colors',
              task.status?.category === 'done'
                ? 'line-through text-muted-foreground'
                : 'text-foreground hover:text-primary'
            )}
            title="Clic para abrir · Doble clic para editar"
          >
            {task.title}
          </button>
        )}
      </div>

      {/* ── Prioridad ──────────────────────────────────────── */}
      <div className="relative flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => { setShowPriorityMenu(!showPriorityMenu); setShowStatusMenu(false); setShowAssignMenu(false) }}
          title={priority.label}
          className={cn('text-xs font-mono w-6 text-center', priority.color)}
        >
          {priority.icon}
        </button>
        {showPriorityMenu && (
          <PriorityMenu
            current={task.priority}
            onSelect={(p) => { setShowPriorityMenu(false); updateTask({ priority: p }) }}
            onClose={() => setShowPriorityMenu(false)}
          />
        )}
      </div>

      {/* ── Fecha de vencimiento ───────────────────────────── */}
      {task.due_date && (
        <span className={cn(
          'flex-shrink-0 text-[11px] px-1.5 py-0.5 rounded',
          new Date(task.due_date) < new Date()
            ? 'bg-destructive/10 text-destructive'
            : 'text-muted-foreground'
        )}>
          {new Date(task.due_date).toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
        </span>
      )}

      {/* ── Asignado ───────────────────────────────────────── */}
      <div className="relative flex-shrink-0">
        <button
          onClick={() => { setShowAssignMenu(!showAssignMenu); setShowStatusMenu(false); setShowPriorityMenu(false) }}
          title={task.assignee?.display_name ?? 'Sin asignar'}
          className="w-6 h-6 rounded-full overflow-hidden bg-muted flex items-center justify-center"
        >
          {task.assignee ? (
            task.assignee.avatar_url ? (
              <Image
                src={task.assignee.avatar_url}
                alt={task.assignee.display_name}
                width={24}
                height={24}
                className="object-cover w-full h-full"
              />
            ) : (
              <span className="text-[9px] font-medium text-muted-foreground">
                {getInitials(task.assignee.display_name)}
              </span>
            )
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" className="text-muted-foreground">
              <circle cx="5" cy="3.5" r="1.8" stroke="currentColor" strokeWidth="1.2" />
              <path d="M1.5 9c0-1.7 1.6-3 3.5-3s3.5 1.3 3.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            </svg>
          )}
        </button>
        {showAssignMenu && (
          <AssignMenu
            members={members}
            currentId={task.assignee?.id}
            onSelect={(id) => { setShowAssignMenu(false); updateTask({ assignee_id: id }) }}
            onClose={() => setShowAssignMenu(false)}
          />
        )}
      </div>

      {/* ── Eliminar (solo hover) ──────────────────────────── */}
      <button
        onClick={deleteTask}
        title="Eliminar tarea"
        className="flex-shrink-0 opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-all"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

// ── Menú de estado ────────────────────────────────────────────────────────────
function StatusMenu({
  statuses,
  currentId,
  onSelect,
  onClose,
}: {
  statuses: Status[]
  currentId?: string
  onSelect: (id: string) => void
  onClose: () => void
}) {
  return (
    <div
      className="absolute top-6 left-0 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 w-44"
      onMouseLeave={onClose}
    >
      {statuses.map(s => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={cn(
            'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors',
            s.id === currentId ? 'text-foreground font-medium' : 'text-muted-foreground'
          )}
        >
          <span
            className="w-2.5 h-2.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: s.color ?? '#94a3b8' }}
          />
          {s.name}
        </button>
      ))}
    </div>
  )
}

// ── Menú de prioridad ─────────────────────────────────────────────────────────
function PriorityMenu({
  current,
  onSelect,
  onClose,
}: {
  current: string
  onSelect: (p: string) => void
  onClose: () => void
}) {
  const priorities = ['urgent', 'high', 'medium', 'low', 'none'] as const
  return (
    <div
      className="absolute top-6 right-0 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 w-40"
      onMouseLeave={onClose}
    >
      {priorities.map(p => {
        const info = PRIORITY_ICONS[p]
        return (
          <button
            key={p}
            onClick={() => onSelect(p)}
            className={cn(
              'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors',
              p === current ? 'text-foreground font-medium' : 'text-muted-foreground'
            )}
          >
            <span className={cn('font-mono w-4 text-center', info.color)}>{info.icon}</span>
            {info.label}
          </button>
        )
      })}
    </div>
  )
}

// ── Menú de asignación ────────────────────────────────────────────────────────
function AssignMenu({
  members,
  currentId,
  onSelect,
  onClose,
}: {
  members: Member[]
  currentId?: string
  onSelect: (id: string | null) => void
  onClose: () => void
}) {
  return (
    <div
      className="absolute top-7 right-0 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 w-44"
      onMouseLeave={onClose}
    >
      <button
        onClick={() => onSelect(null)}
        className={cn(
          'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors',
          !currentId ? 'text-foreground font-medium' : 'text-muted-foreground'
        )}
      >
        <div className="w-5 h-5 rounded-full bg-muted flex items-center justify-center">
          <svg width="9" height="9" viewBox="0 0 10 10" fill="none">
            <circle cx="5" cy="3.5" r="1.8" stroke="currentColor" strokeWidth="1.2" />
            <path d="M1.5 9c0-1.7 1.6-3 3.5-3s3.5 1.3 3.5 3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </div>
        Sin asignar
      </button>
      {members.map(m => (
        <button
          key={m.id}
          onClick={() => onSelect(m.id)}
          className={cn(
            'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors',
            m.id === currentId ? 'text-foreground font-medium' : 'text-muted-foreground'
          )}
        >
          <div className="w-5 h-5 rounded-full bg-muted overflow-hidden flex-shrink-0">
            {m.avatar_url ? (
              <Image src={m.avatar_url} alt={m.display_name} width={20} height={20} className="object-cover" />
            ) : (
              <span className="flex items-center justify-center w-full h-full text-[9px] font-medium">
                {getInitials(m.display_name)}
              </span>
            )}
          </div>
          <span className="truncate">{m.display_name}</span>
        </button>
      ))}
    </div>
  )
}

'use client'

/**
 * Fila de tarea en la vista de lista.
 * Permite edición inline de título, estado y prioridad.
 */
import { useState, useRef, useEffect } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
import { ChevronsUp, ChevronUp, Equal, ChevronDown, Minus, ListChecks, Repeat, type LucideIcon } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { LabelChips } from './TaskLabels'
import { CustomFieldCells, type CustomFieldDef } from './CustomFieldCells'
import { StackedAvatars } from './StackedAvatars'

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

interface TaskRowProps {
  task: Task
  statuses: Status[]
  members: Member[]
  currentUserId: string
  onUpdated: (task: Task) => void
  onDeleted: (taskId: string) => void
  onOpen?: () => void
  // Multi-seleccion para acciones masivas (opcional).
  selected?: boolean
  selectionActive?: boolean
  onToggleSelect?: (taskId: string, shiftKey: boolean) => void
  // Campos personalizados del proyecto + valores de esta tarea (solo-lectura).
  customFields?: CustomFieldDef[]
  customValues?: Record<string, unknown>
}

// Cierra menús flotantes con Escape (accesibilidad de teclado; onMouseLeave
// solo cubre mouse y el overlay solo cubre click/touch).
function useEscapeToClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
}

const PRIORITY_ICONS: Record<string, { Icon: LucideIcon; label: string; color: string }> = {
  urgent: { Icon: ChevronsUp,  label: 'Urgente', color: 'text-red-500' },
  high:   { Icon: ChevronUp,   label: 'Alta',    color: 'text-orange-500' },
  medium: { Icon: Equal,       label: 'Media',   color: 'text-yellow-500' },
  low:    { Icon: ChevronDown, label: 'Baja',    color: 'text-blue-400' },
  none:   { Icon: Minus,       label: 'Sin prioridad', color: 'text-muted-foreground' },
}

// Clasifica la fecha de vencimiento relativa a HOY (medianoche local). El
// 'YYYY-MM-DD' se parsea como fecha local (no UTC) para no correrla un dia por
// zona horaria. Mismo criterio que el tablero Kanban para consistencia visual.
function dueBucket(due: string | null | undefined, isDone: boolean): 'overdue' | 'today' | 'future' | null {
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

export function TaskRow({
  task,
  statuses,
  members,
  onUpdated,
  onDeleted,
  onOpen,
  selected = false,
  selectionActive = false,
  onToggleSelect,
  customFields,
  customValues,
}: TaskRowProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [title, setTitle] = useState(task.title)
  const [showStatusMenu, setShowStatusMenu] = useState(false)
  const [showPriorityMenu, setShowPriorityMenu] = useState(false)
  const [showAssignMenu, setShowAssignMenu] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Actualizar campo de la tarea (optimista) ──────────────────────────────
  // La UI refleja el cambio al instante (patrón Linear/ClickUp) y se revierte
  // con toast si el servidor rechaza. Sin bloqueo visual durante el fetch.
  const updateTask = async (patch: Partial<{ title: string; status_id: string; priority: string; assignee_id: string | null }>) => {
    const previous = task
    const optimistic: Task = { ...task }
    if (patch.title !== undefined) optimistic.title = patch.title
    if (patch.priority !== undefined) optimistic.priority = patch.priority
    if (patch.status_id !== undefined) {
      const s = statuses.find(x => x.id === patch.status_id)
      if (s) optimistic.status = { id: s.id, name: s.name, color: s.color, category: s.category }
    }
    if (patch.assignee_id !== undefined) {
      if (patch.assignee_id === null) {
        optimistic.assignee = null
        optimistic.assignees = []
      } else {
        const m = members.find(x => x.id === patch.assignee_id)
        if (m) {
          optimistic.assignee = { id: m.id, display_name: m.display_name, avatar_url: m.avatar_url }
          optimistic.assignees = [{ id: m.id, display_name: m.display_name, avatar_url: m.avatar_url }]
        }
      }
    }
    onUpdated(optimistic)

    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: null }))
        throw new Error(err.error ?? 'Error al actualizar')
      }

      const updated: Task = await res.json()
      // Merge sobre el optimista: si el servidor devuelve menos campos
      // (labels, subtareas), se conservan los que ya estaban en la fila.
      onUpdated({ ...optimistic, ...updated })
    } catch (err) {
      onUpdated(previous) // revertir al estado previo a la edición
      toast.error(err instanceof Error ? err.message : 'Error al actualizar la tarea')
    }
  }

  const deleteTask = async () => {
    if (!(await confirmDialog({ message: '¿Eliminar esta tarea?', destructive: true, confirmLabel: 'Eliminar' }))) return
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
      selected && 'bg-primary/5 hover:bg-primary/10',
      isLoading && 'opacity-60 pointer-events-none'
    )}>
      {/* ── Checkbox de seleccion (aparece al hover o si hay seleccion activa) ── */}
      {onToggleSelect && (
        <button
          onClick={(e) => onToggleSelect(task.id, e.shiftKey)}
          title={selected ? 'Quitar de la seleccion' : 'Seleccionar'}
          className={cn(
            'flex-shrink-0 w-4 h-4 rounded border flex items-center justify-center transition-all',
            selected
              ? 'bg-primary border-primary text-primary-foreground'
              : 'border-border text-transparent hover:border-primary',
            !selected && !selectionActive && 'opacity-0 group-hover:opacity-100',
          )}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M1.5 5l2.5 2.5 4.5-5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

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
          className={cn('flex items-center justify-center w-6', priority.color)}
        >
          <priority.Icon className="h-4 w-4" />
        </button>
        {showPriorityMenu && (
          <PriorityMenu
            current={task.priority}
            onSelect={(p) => { setShowPriorityMenu(false); updateTask({ priority: p }) }}
            onClose={() => setShowPriorityMenu(false)}
          />
        )}
      </div>

      {/* ── Etiquetas ──────────────────────────────────────── */}
      {task.labels && task.labels.length > 0 && (
        <LabelChips labels={task.labels} className="flex-shrink-0 max-w-[40%]" />
      )}

      {/* ── Campos personalizados (solo-lectura, editables en el panel) ── */}
      {customFields && customFields.length > 0 && (
        <CustomFieldCells fields={customFields} values={customValues} />
      )}

      {/* ── Progreso de subtareas ──────────────────────────── */}
      {typeof task.subtaskTotal === 'number' && task.subtaskTotal > 0 && (
        <span
          title={`${task.subtaskDone ?? 0} de ${task.subtaskTotal} subtareas completadas`}
          className={cn(
            'flex-shrink-0 flex items-center gap-1 text-[11px]',
            (task.subtaskDone ?? 0) === task.subtaskTotal
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-muted-foreground'
          )}
        >
          <ListChecks className="w-3 h-3" />
          {task.subtaskDone ?? 0}/{task.subtaskTotal}
        </span>
      )}

      {/* ── Tarea recurrente ───────────────────────────────── */}
      {task.recurrence_rule && (
        <span title="Tarea recurrente" className="flex-shrink-0 flex items-center text-muted-foreground">
          <Repeat className="w-3 h-3" />
        </span>
      )}

      {/* ── Fecha de vencimiento ───────────────────────────── */}
      {task.due_date && (() => {
        const bucket = dueBucket(task.due_date, task.status?.category === 'done')
        return (
          <span className={cn(
            'flex-shrink-0 text-[11px] px-1.5 py-0.5 rounded',
            bucket === 'overdue'
              ? 'bg-destructive/10 text-destructive font-medium'
              : bucket === 'today'
                ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-medium'
                : 'text-muted-foreground'
          )}>
            {bucket === 'today'
              ? 'Hoy'
              : new Date(String(task.due_date).slice(0, 10) + 'T00:00:00').toLocaleDateString('es-MX', { month: 'short', day: 'numeric' })}
          </span>
        )
      })()}

      {/* ── Asignados ──────────────────────────────────────── */}
      <div className="relative flex-shrink-0">
        {task.assignees && task.assignees.length > 0 ? (
          <button
            onClick={() => { setShowAssignMenu(!showAssignMenu); setShowStatusMenu(false); setShowPriorityMenu(false) }}
            title="Asignados"
            className="flex items-center h-6"
          >
            <StackedAvatars assignees={task.assignees} />
          </button>
        ) : (
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
        )}
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
        aria-label="Eliminar tarea"
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
  useEscapeToClose(onClose)
  return (
    <>
    <div className="fixed inset-0 z-40" onClick={onClose} />
    <div
      className="absolute top-6 left-0 z-50 bg-popover border border-border rounded-lg shadow-raised py-1 w-44"
      onMouseLeave={onClose}
    >
      {statuses.map(s => (
        <button
          key={s.id}
          onClick={() => onSelect(s.id)}
          className={cn(
            'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none transition-colors',
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
    </>
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
  useEscapeToClose(onClose)
  return (
    <>
    <div className="fixed inset-0 z-40" onClick={onClose} />
    <div
      className="absolute top-6 right-0 z-50 bg-popover border border-border rounded-lg shadow-raised py-1 w-40"
      onMouseLeave={onClose}
    >
      {priorities.map(p => {
        const info = PRIORITY_ICONS[p]
        return (
          <button
            key={p}
            onClick={() => onSelect(p)}
            className={cn(
              'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none transition-colors',
              p === current ? 'text-foreground font-medium' : 'text-muted-foreground'
            )}
          >
            <info.Icon className={cn('h-4 w-4 flex-shrink-0', info.color)} />
            {info.label}
          </button>
        )
      })}
    </div>
    </>
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
  useEscapeToClose(onClose)
  return (
    <>
    <div className="fixed inset-0 z-40" onClick={onClose} />
    <div
      className="absolute top-7 right-0 z-50 bg-popover border border-border rounded-lg shadow-raised py-1 w-44"
      onMouseLeave={onClose}
    >
      <button
        onClick={() => onSelect(null)}
        className={cn(
          'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none transition-colors',
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
            'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none transition-colors',
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
    </>
  )
}

'use client'

/**
 * Vista de Tabla (grid) de tareas, estilo ClickUp/Notion.
 *
 * Tabla densa y ordenable con columnas para Titulo, Estado, Prioridad,
 * Asignados, Fecha de vencimiento y los campos personalizados del proyecto.
 * Los campos personalizados son editables en linea (reutiliza el endpoint
 * POST /api/tasks/[taskId]/custom-fields, la misma fuente de verdad que el
 * panel de detalle). Estado, prioridad, asignado y fecha se editan via
 * PATCH /api/tasks/[taskId] (los mismos endpoints de la vista de lista).
 *
 * Es un hermano de TaskListView: consume los mismos props (tasks/statuses/
 * members) para no acoplarse a los internos de la lista. Las filas abren el
 * panel de detalle de la tarea.
 */
import { useState, useEffect, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { toast } from 'sonner'
import {
  ArrowUp, ArrowDown, ChevronsUpDown, Table2,
  ChevronsUp, ChevronUp, Equal, ChevronDown, Minus,
  type LucideIcon,
} from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'
import { EmptyState } from '@/components/ui/EmptyState'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { TaskDetailPanel } from './TaskDetailPanel'
import { BulkActionBar } from './BulkActionBar'
import { formatFieldValue, type CustomFieldDef } from './CustomFieldCells'

interface Status {
  id: string
  name: string
  color: string | null
  category: string
  position: number
}

interface Member {
  id: string
  display_name: string
  avatar_url: string | null
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

interface Label { id: string; name: string; color: string }
interface Sprint { id: string; name: string; status: string }
interface SiblingProject { id: string; name: string; icon: string | null }

interface TaskTableViewProps {
  projectId: string
  tasks: Task[]
  statuses: Status[]
  members: Member[]
  currentUserId: string
  initialTaskId?: string
  labels?: Label[]
  sprints?: Sprint[]
  projects?: SiblingProject[]
}

const PRIORITY_META: Record<string, { Icon: LucideIcon; label: string; color: string; rank: number }> = {
  urgent: { Icon: ChevronsUp,  label: 'Urgente', color: 'text-red-500',    rank: 4 },
  high:   { Icon: ChevronUp,   label: 'Alta',    color: 'text-orange-500', rank: 3 },
  medium: { Icon: Equal,       label: 'Media',   color: 'text-yellow-500', rank: 2 },
  low:    { Icon: ChevronDown, label: 'Baja',    color: 'text-blue-400',   rank: 1 },
  none:   { Icon: Minus,       label: 'Sin prioridad', color: 'text-muted-foreground', rank: 0 },
}

type SortDir = 'asc' | 'desc'
type SortKey = 'title' | 'status' | 'priority' | 'assignee' | 'due_date' | `cf:${string}`

function dueMillis(due: string | null): number {
  if (!due) return Number.POSITIVE_INFINITY
  const d = new Date(String(due).slice(0, 10) + 'T00:00:00')
  return Number.isNaN(d.getTime()) ? Number.POSITIVE_INFINITY : d.getTime()
}

export function TaskTableView({
  projectId,
  tasks: initialTasks,
  statuses,
  members,
  currentUserId,
  initialTaskId,
  labels,
  sprints,
  projects,
}: TaskTableViewProps) {
  const router = useRouter()
  const [tasks, setTasks] = useState<Task[]>(initialTasks)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([])
  const [customValues, setCustomValues] = useState<Record<string, Record<string, unknown>>>({})
  const [sortKey, setSortKey] = useState<SortKey>('title')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  useRealtimeRefresh({
    channel: `proj-table-${projectId}`,
    tables: [
      { table: 'tasks',         filter: `project_id=eq.${projectId}` },
      { table: 'task_statuses', filter: `project_id=eq.${projectId}` },
    ],
  })
  useEffect(() => { setTasks(initialTasks) }, [initialTasks])

  // Carga campos personalizados + valores por tarea en una sola llamada.
  useEffect(() => {
    let alive = true
    fetch(`/api/projects/${projectId}/custom-fields/values`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!alive || !data) return
        setCustomFields(data.fields ?? [])
        setCustomValues(data.values ?? {})
      })
      .catch(() => { /* silencioso: la tabla funciona sin campos personalizados */ })
    return () => { alive = false }
  }, [projectId])

  const clearSelection = () => setSelectedIds(new Set())
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const toggleAll = () => {
    setSelectedIds(prev => (prev.size === tasks.length ? new Set() : new Set(tasks.map(t => t.id))))
  }

  const handleBulkApplied = () => { clearSelection(); router.refresh() }
  const handleTaskUpdated = (updated: Task) => {
    setTasks(prev => prev.map(t => (t.id === updated.id ? { ...t, ...updated } : t)))
  }
  const handleTaskDeleted = (id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
    toast.success('Tarea eliminada')
    router.refresh()
  }

  // PATCH inline de un campo estandar de la tarea (mismo endpoint que la lista).
  const patchTask = useCallback(async (id: string, patch: Record<string, unknown>) => {
    const previous = tasks.find(t => t.id === id)
    if (!previous) return
    // optimista
    const optimistic: Task = { ...previous }
    if ('priority' in patch) optimistic.priority = patch.priority as string
    if ('status_id' in patch) {
      const s = statuses.find(x => x.id === patch.status_id)
      optimistic.status = s ? { id: s.id, name: s.name, color: s.color, category: s.category } : null
    }
    if ('assignee_id' in patch) {
      const m = patch.assignee_id ? members.find(x => x.id === patch.assignee_id) : null
      optimistic.assignee = m ? { id: m.id, display_name: m.display_name, avatar_url: m.avatar_url } : null
      optimistic.assignees = m ? [{ id: m.id, display_name: m.display_name, avatar_url: m.avatar_url }] : []
    }
    if ('due_date' in patch) {
      optimistic.due_date = patch.due_date ? String(patch.due_date).slice(0, 10) : null
    }
    handleTaskUpdated(optimistic)
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Error al actualizar')
      }
      const updated: Task = await res.json()
      handleTaskUpdated({ ...optimistic, ...updated })
    } catch (e) {
      handleTaskUpdated(previous)
      toast.error(e instanceof Error ? e.message : 'Error al actualizar')
    }
  }, [tasks, statuses, members])

  // Upsert inline del valor de un campo personalizado (misma ruta que el panel).
  const saveCustomValue = useCallback(async (taskId: string, fieldId: string, value: unknown) => {
    const prevValues = customValues[taskId] ?? {}
    setCustomValues(prev => ({ ...prev, [taskId]: { ...prev[taskId], [fieldId]: value } }))
    try {
      const res = await fetch(`/api/tasks/${taskId}/custom-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_id: fieldId, value }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? '')
      }
    } catch (e) {
      setCustomValues(prev => ({ ...prev, [taskId]: prevValues }))
      toast.error(e instanceof Error && e.message ? e.message : 'Error al guardar el campo')
    }
  }, [customValues])

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedTasks = useMemo(() => {
    const arr = [...tasks]
    const dir = sortDir === 'asc' ? 1 : -1
    const cmp = (a: Task, b: Task): number => {
      switch (sortKey) {
        case 'title':
          return a.title.localeCompare(b.title, 'es') * dir
        case 'status':
          return (a.status?.name ?? '').localeCompare(b.status?.name ?? '', 'es') * dir
        case 'priority':
          return ((PRIORITY_META[a.priority]?.rank ?? 0) - (PRIORITY_META[b.priority]?.rank ?? 0)) * dir
        case 'assignee':
          return (a.assignee?.display_name ?? '').localeCompare(b.assignee?.display_name ?? '', 'es') * dir
        case 'due_date':
          return (dueMillis(a.due_date) - dueMillis(b.due_date)) * dir
        default: {
          // campo personalizado: ordena por su texto formateado.
          const fieldId = sortKey.slice(3)
          const def = customFields.find(f => f.id === fieldId)
          if (!def) return 0
          const ta = formatFieldValue(def, customValues[a.id]?.[fieldId])?.text ?? ''
          const tb = formatFieldValue(def, customValues[b.id]?.[fieldId])?.text ?? ''
          if (def.field_type === 'number' || def.field_type === 'currency') {
            const na = Number(customValues[a.id]?.[fieldId] ?? Number.NEGATIVE_INFINITY)
            const nb = Number(customValues[b.id]?.[fieldId] ?? Number.NEGATIVE_INFINITY)
            return (na - nb) * dir
          }
          return ta.localeCompare(tb, 'es') * dir
        }
      }
    }
    return arr.sort(cmp)
  }, [tasks, sortKey, sortDir, customFields, customValues])

  if (tasks.length === 0) {
    return (
      <div className="px-6 py-10">
        <EmptyState
          icon={<Table2 className="h-5 w-5" aria-hidden />}
          title="No hay tareas en este proyecto todavia"
          description="Crea tareas desde la vista de Lista o Tablero para verlas aqui."
        />
      </div>
    )
  }

  const allSelected = selectedIds.size === tasks.length && tasks.length > 0

  return (
    <div className="px-6 py-4">
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

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-border bg-muted/40 text-muted-foreground">
              <th className="w-9 px-2 py-2 text-left">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Seleccionar todas"
                  className="w-4 h-4 rounded border-input accent-primary cursor-pointer"
                />
              </th>
              <SortHeader label="Titulo" active={sortKey === 'title'} dir={sortDir} onClick={() => toggleSort('title')} className="min-w-[240px]" />
              <SortHeader label="Estado" active={sortKey === 'status'} dir={sortDir} onClick={() => toggleSort('status')} />
              <SortHeader label="Prioridad" active={sortKey === 'priority'} dir={sortDir} onClick={() => toggleSort('priority')} />
              <SortHeader label="Asignados" active={sortKey === 'assignee'} dir={sortDir} onClick={() => toggleSort('assignee')} />
              <SortHeader label="Fecha" active={sortKey === 'due_date'} dir={sortDir} onClick={() => toggleSort('due_date')} />
              {customFields.map(f => (
                <SortHeader
                  key={f.id}
                  label={f.name}
                  active={sortKey === `cf:${f.id}`}
                  dir={sortDir}
                  onClick={() => toggleSort(`cf:${f.id}`)}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedTasks.map(task => {
              const prio = PRIORITY_META[task.priority] ?? PRIORITY_META.none
              const isDone = task.status?.category === 'done'
              return (
                <tr
                  key={task.id}
                  className={cn(
                    'border-b border-border/60 last:border-0 hover:bg-muted/30 transition-colors',
                    selectedIds.has(task.id) && 'bg-primary/5 hover:bg-primary/10',
                  )}
                >
                  <td className="px-2 py-1.5 align-middle">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(task.id)}
                      onChange={() => toggleSelect(task.id)}
                      aria-label="Seleccionar tarea"
                      className="w-4 h-4 rounded border-input accent-primary cursor-pointer"
                    />
                  </td>

                  {/* Titulo: abre el panel de detalle */}
                  <td className="px-2 py-1.5 align-middle">
                    <button
                      onClick={() => setSelectedTaskId(task.id)}
                      className={cn(
                        'text-left w-full truncate transition-colors',
                        isDone ? 'line-through text-muted-foreground' : 'text-foreground hover:text-primary',
                      )}
                      title="Abrir tarea"
                    >
                      {task.title}
                    </button>
                  </td>

                  {/* Estado (select inline) */}
                  <td className="px-2 py-1.5 align-middle">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: task.status?.color ?? '#94a3b8' }}
                      />
                      <select
                        value={task.status?.id ?? ''}
                        onChange={e => patchTask(task.id, { status_id: e.target.value || null })}
                        className="text-xs bg-transparent border border-transparent hover:border-border rounded px-1 py-0.5 outline-none focus:border-primary cursor-pointer text-foreground [&>option]:bg-background max-w-[130px]"
                        aria-label="Estado"
                      >
                        <option value="">Sin estado</option>
                        {statuses.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                  </td>

                  {/* Prioridad (select inline) */}
                  <td className="px-2 py-1.5 align-middle">
                    <div className="flex items-center gap-1.5">
                      <prio.Icon className={cn('w-4 h-4 flex-shrink-0', prio.color)} />
                      <select
                        value={task.priority}
                        onChange={e => patchTask(task.id, { priority: e.target.value })}
                        className="text-xs bg-transparent border border-transparent hover:border-border rounded px-1 py-0.5 outline-none focus:border-primary cursor-pointer text-foreground [&>option]:bg-background"
                        aria-label="Prioridad"
                      >
                        {Object.entries(PRIORITY_META).map(([value, m]) => (
                          <option key={value} value={value}>{m.label}</option>
                        ))}
                      </select>
                    </div>
                  </td>

                  {/* Asignado (select inline, principal) */}
                  <td className="px-2 py-1.5 align-middle">
                    <div className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-muted overflow-hidden flex items-center justify-center flex-shrink-0">
                        {task.assignee?.avatar_url ? (
                          <Image src={task.assignee.avatar_url} alt={task.assignee.display_name} width={20} height={20} className="object-cover" />
                        ) : task.assignee ? (
                          <span className="text-[9px] font-medium">{getInitials(task.assignee.display_name)}</span>
                        ) : (
                          <span className="text-[9px] text-muted-foreground">?</span>
                        )}
                      </span>
                      <select
                        value={task.assignee?.id ?? ''}
                        onChange={e => patchTask(task.id, { assignee_id: e.target.value || null })}
                        className="text-xs bg-transparent border border-transparent hover:border-border rounded px-1 py-0.5 outline-none focus:border-primary cursor-pointer text-foreground [&>option]:bg-background max-w-[130px]"
                        aria-label="Asignado"
                      >
                        <option value="">Sin asignar</option>
                        {members.map(m => (
                          <option key={m.id} value={m.id}>{m.display_name}</option>
                        ))}
                      </select>
                    </div>
                  </td>

                  {/* Fecha de vencimiento (date inline) */}
                  <td className="px-2 py-1.5 align-middle">
                    <input
                      type="date"
                      value={task.due_date ? String(task.due_date).slice(0, 10) : ''}
                      onChange={e => patchTask(task.id, { due_date: e.target.value ? new Date(e.target.value + 'T00:00:00').toISOString() : null })}
                      className="text-xs bg-transparent border border-transparent hover:border-border rounded px-1 py-0.5 outline-none focus:border-primary cursor-pointer text-foreground"
                      aria-label="Fecha de vencimiento"
                    />
                  </td>

                  {/* Campos personalizados (editables en linea) */}
                  {customFields.map(f => (
                    <td key={f.id} className="px-2 py-1.5 align-middle">
                      <CustomFieldCell
                        field={f}
                        value={customValues[task.id]?.[f.id]}
                        onSave={v => saveCustomValue(task.id, f.id, v)}
                      />
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selectedIds.size > 0 && (
        <BulkActionBar
          projectId={projectId}
          selectedIds={Array.from(selectedIds)}
          statuses={statuses}
          members={members}
          onClear={clearSelection}
          onApplied={handleBulkApplied}
          labels={labels}
          sprints={sprints}
          projects={projects}
        />
      )}
    </div>
  )
}

// ── Encabezado de columna ordenable ─────────────────────────────────────────────
function SortHeader({
  label, active, dir, onClick, className,
}: {
  label: string
  active: boolean
  dir: SortDir
  onClick: () => void
  className?: string
}) {
  return (
    <th className={cn('px-2 py-2 text-left font-medium', className)}>
      <button
        onClick={onClick}
        className={cn(
          'inline-flex items-center gap-1 text-[11px] uppercase tracking-wide transition-colors',
          active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )}
        title={`Ordenar por ${label}`}
      >
        <span className="truncate max-w-[120px]">{label}</span>
        {active ? (
          dir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
        ) : (
          <ChevronsUpDown className="w-3 h-3 opacity-50" />
        )}
      </button>
    </th>
  )
}

// ── Celda editable de campo personalizado ───────────────────────────────────────
function CustomFieldCell({
  field, value, onSave,
}: {
  field: CustomFieldDef
  value: unknown
  onSave: (v: unknown) => void
}) {
  const base = 'w-full text-xs bg-transparent border border-transparent hover:border-border rounded px-1 py-0.5 outline-none focus:border-primary transition-colors text-foreground'

  switch (field.field_type) {
    case 'text':
      return (
        <input
          type="text"
          defaultValue={typeof value === 'string' ? value : ''}
          onBlur={e => { const v = e.target.value.trim(); onSave(v || null) }}
          className={cn(base, 'min-w-[100px]')}
          placeholder="Vacio"
        />
      )
    case 'url':
      return (
        <input
          type="url"
          defaultValue={typeof value === 'string' ? value : ''}
          onBlur={e => { const v = e.target.value.trim(); onSave(v || null) }}
          className={cn(base, 'min-w-[100px]')}
          placeholder="https://"
        />
      )
    case 'number':
      return (
        <input
          type="number"
          defaultValue={typeof value === 'number' ? value : ''}
          onBlur={e => { const v = e.target.value; onSave(v === '' ? null : Number(v)) }}
          className={cn(base, 'w-20')}
          placeholder="0"
        />
      )
    case 'currency':
      return (
        <div className="relative w-24">
          <span className="absolute left-1 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
          <input
            type="number"
            step="0.01"
            defaultValue={typeof value === 'number' ? value : ''}
            onBlur={e => { const v = e.target.value; onSave(v === '' ? null : Number(v)) }}
            className={cn(base, 'pl-4')}
            placeholder="0.00"
          />
        </div>
      )
    case 'date':
      return (
        <input
          type="date"
          defaultValue={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={e => onSave(e.target.value || null)}
          className={cn(base, 'cursor-pointer')}
        />
      )
    case 'checkbox':
      return (
        <input
          type="checkbox"
          checked={value === true}
          onChange={e => onSave(e.target.checked)}
          className="w-4 h-4 rounded border-input accent-primary cursor-pointer"
          aria-label={field.name}
        />
      )
    case 'select':
      return (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={e => onSave(e.target.value || null)}
          className={cn(base, 'cursor-pointer [&>option]:bg-background')}
          aria-label={field.name}
        >
          <option value="">Sin seleccionar</option>
          {field.options.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      )
    case 'multi_select': {
      const selected: string[] = Array.isArray(value) ? (value as string[]) : []
      const toggle = (id: string) => {
        const next = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
        onSave(next)
      }
      return (
        <div className="flex flex-wrap gap-1 min-w-[120px]">
          {field.options.length === 0 && <span className="text-[10px] text-muted-foreground">Sin opciones</span>}
          {field.options.map(o => {
            const on = selected.includes(o.id)
            return (
              <button
                key={o.id}
                onClick={() => toggle(o.id)}
                className={cn(
                  'px-1.5 py-0.5 rounded-full text-[10px] font-medium border transition-colors',
                  on
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-transparent border-border text-muted-foreground hover:border-primary/40',
                )}
                style={on && o.color ? { backgroundColor: `${o.color}22`, borderColor: o.color, color: o.color } : undefined}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      )
    }
    default:
      return <span className="text-xs text-muted-foreground">-</span>
  }
}

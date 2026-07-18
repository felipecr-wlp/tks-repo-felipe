'use client'

/**
 * Vista de lista de tareas, muestra tareas agrupadas por estado.
 * Permite crear tareas inline y cambiar estado/prioridad.
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { ListTodo, Search, X, Layers, Filter, CheckCircle2, AlertTriangle, CalendarClock } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { TaskRow as TaskItem } from './TaskRow'
import { CreateTaskInline } from './CreateTaskInline'
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

// Clasifica el vencimiento relativo a HOY (medianoche local, sin corrimiento por
// zona horaria). Mismo criterio que el tablero y la fila de lista.
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
  // Campos personalizados del proyecto + sus valores por tarea (para la lista).
  const [customFields, setCustomFields] = useState<CustomFieldDef[]>([])
  const [customValues, setCustomValues] = useState<Record<string, Record<string, unknown>>>({})
  // Agrupar por: 'status' (default) o el id de un campo personalizado.
  const [groupBy, setGroupBy] = useState<string>('status')
  // Filtro por campo personalizado: id del campo + valor (interpretado por tipo).
  const [filterFieldId, setFilterFieldId] = useState<string>('')
  const [filterValue, setFilterValue] = useState<string>('')

  // Colaboración en vivo: sincroniza la lista cuando otro usuario cambia tareas.
  useRealtimeRefresh({
    channel: `proj-list-${projectId}`,
    tables: [
      { table: 'tasks',         filter: `project_id=eq.${projectId}` },
      { table: 'task_statuses', filter: `project_id=eq.${projectId}` },
    ],
  })
  useEffect(() => { setTasks(initialTasks) }, [initialTasks])

  // Carga en bloque los campos personalizados y sus valores (una sola llamada).
  useEffect(() => {
    let alive = true
    fetch(`/api/projects/${projectId}/custom-fields/values`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!alive || !data) return
        setCustomFields(data.fields ?? [])
        setCustomValues(data.values ?? {})
      })
      .catch(() => { /* silencioso: la lista funciona sin campos personalizados */ })
    return () => { alive = false }
  }, [projectId])

  const filterField = customFields.find(f => f.id === filterFieldId) ?? null

  // ¿La tarea pasa el filtro por campo personalizado activo?
  const passesCustomFilter = (taskId: string): boolean => {
    if (!filterField || filterValue === '') return true
    const v = customValues[taskId]?.[filterField.id]
    switch (filterField.field_type) {
      case 'select':
        return v === filterValue
      case 'multi_select':
        return Array.isArray(v) && v.includes(filterValue)
      case 'checkbox':
        return filterValue === 'true' ? v === true : v !== true
      default: {
        const empty = v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0)
        return filterValue === '__empty__' ? empty : !empty
      }
    }
  }

  // Orden visual plano (relleno tras construir los grupos) para el Shift-range.
  const orderedIdsRef: string[] = []

  const toggleSelect = (taskId: string, shiftKey: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (shiftKey && lastSelectedId && lastSelectedId !== taskId) {
        // Seleccion por rango: marca todo entre la ultima y la actual.
        const a = orderedIdsRef.indexOf(lastSelectedId)
        const b = orderedIdsRef.indexOf(taskId)
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          for (let i = lo; i <= hi; i++) next.add(orderedIdsRef[i])
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

  // Búsqueda por título (client-side) + filtro por campo personalizado.
  const q = search.trim().toLowerCase()
  const matches = (t: Task) => (q === '' || t.title.toLowerCase().includes(q)) && passesCustomFilter(t.id)
  const visibleTasks = tasks.filter(matches)

  // Modelo de grupos unificado: por estado (default) o por campo personalizado.
  // status !== undefined solo en modo estado, para el punto de color + crear inline.
  interface RenderGroup {
    key: string
    label: string
    color: string | null
    tasks: Task[]
    status?: Status
  }
  const groupByField = groupBy !== 'status' ? customFields.find(f => f.id === groupBy) ?? null : null

  let groups: RenderGroup[]
  if (groupByField) {
    // Agrupar por el valor formateado del campo (cada tarea en un bucket).
    const buckets = new Map<string, RenderGroup>()
    for (const t of visibleTasks) {
      const fmt = formatFieldValue(groupByField, customValues[t.id]?.[groupByField.id])
      const key = fmt ? `v:${fmt.text}` : '__none__'
      const label = fmt ? fmt.text : 'Sin valor'
      if (!buckets.has(key)) buckets.set(key, { key, label, color: fmt?.color ?? null, tasks: [] })
      buckets.get(key)!.tasks.push(t)
    }
    // 'Sin valor' al final; el resto por orden de aparicion.
    groups = [...buckets.values()].sort((a, b) => {
      if (a.key === '__none__') return 1
      if (b.key === '__none__') return -1
      return 0
    })
  } else {
    groups = statuses.map(s => ({
      key: s.id,
      label: s.name,
      color: s.color,
      tasks: visibleTasks.filter(t => t.status?.id === s.id),
      status: s,
    }))
    const unassigned = visibleTasks.filter(t => !t.status)
    if (unassigned.length > 0) {
      groups.push({ key: '__unassigned__', label: 'Sin estado', color: null, tasks: unassigned })
    }
  }

  // Rellena el orden plano segun el agrupado actual (para el Shift-range).
  orderedIdsRef.length = 0
  for (const g of groups) for (const t of g.tasks) orderedIdsRef.push(t.id)

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
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
      {/* Barra de búsqueda + agrupar + filtrar */}
      {tasks.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative max-w-xs flex-1 min-w-[180px]">
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

          {customFields.length > 0 && (
            <>
              {/* Agrupar por */}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Layers className="w-3.5 h-3.5" />
                <select
                  value={groupBy}
                  onChange={e => { setGroupBy(e.target.value); setCollapsedGroups(new Set()) }}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring cursor-pointer"
                >
                  <option value="status">Agrupar: Estado</option>
                  {customFields.map(f => (
                    <option key={f.id} value={f.id}>Agrupar: {f.name}</option>
                  ))}
                </select>
              </label>

              {/* Filtrar por campo */}
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Filter className="w-3.5 h-3.5" />
                <select
                  value={filterFieldId}
                  onChange={e => { setFilterFieldId(e.target.value); setFilterValue('') }}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring cursor-pointer"
                >
                  <option value="">Filtrar: (ninguno)</option>
                  {customFields.map(f => (
                    <option key={f.id} value={f.id}>Filtrar: {f.name}</option>
                  ))}
                </select>
              </label>

              {/* Valor del filtro, adaptado al tipo del campo */}
              {filterField && (
                <select
                  value={filterValue}
                  onChange={e => setFilterValue(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring cursor-pointer"
                >
                  <option value="">(cualquiera)</option>
                  {(filterField.field_type === 'select' || filterField.field_type === 'multi_select') &&
                    filterField.options.map(o => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  {filterField.field_type === 'checkbox' && (
                    <>
                      <option value="true">Si</option>
                      <option value="false">No</option>
                    </>
                  )}
                  {!['select', 'multi_select', 'checkbox'].includes(filterField.field_type) && (
                    <>
                      <option value="__has__">Con valor</option>
                      <option value="__empty__">Sin valor</option>
                    </>
                  )}
                </select>
              )}

              {(filterFieldId || groupBy !== 'status') && (
                <button
                  onClick={() => { setGroupBy('status'); setFilterFieldId(''); setFilterValue('') }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline decoration-dotted"
                >
                  Restablecer
                </button>
              )}
            </>
          )}
        </div>
      )}

      {/* Salud del proyecto: barra de completado + conteos clave */}
      {tasks.length > 0 && (() => {
        const total = tasks.length
        const doneCount = tasks.filter(t => t.status?.category === 'done').length
        const overdueCount = tasks.filter(t => dueBucket(t.due_date, t.status?.category === 'done') === 'overdue').length
        const todayCount = tasks.filter(t => dueBucket(t.due_date, t.status?.category === 'done') === 'today').length
        const donePct = total === 0 ? 0 : Math.round((doneCount / total) * 100)
        return (
          <div className="mb-4 flex items-center gap-x-4 gap-y-1.5 flex-wrap">
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
        )
      })()}

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

      {/* Grupos de tareas (por estado o por campo personalizado) */}
      {(q === '' || visibleTasks.length > 0) && groups.map(group => {
        const isCollapsed = collapsedGroups.has(group.key)
        const isDoneCategory = group.status?.category === 'done'

        // Durante una búsqueda/filtro activo, ocultar grupos sin coincidencias.
        if ((q !== '' || filterFieldId) && group.tasks.length === 0) return null

        return (
          <div key={group.key} className="mb-6">
            {/* Header del grupo */}
            <div className="flex items-center gap-2 mb-1.5 group/header">
              <button
                onClick={() => toggleGroup(group.key)}
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
                  style={{ backgroundColor: group.color ?? '#94a3b8' }}
                />
                <span className="text-foreground">{group.label}</span>
                <span className="text-xs text-muted-foreground font-normal">
                  {group.tasks.length}
                </span>
              </button>
            </div>

            {/* Tareas del grupo */}
            {!isCollapsed && (
              <div className="space-y-0.5">
                {group.tasks.map(task => (
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
                    customFields={customFields}
                    customValues={customValues[task.id]}
                  />
                ))}

                {/* Crear tarea inline: solo en modo estado, no-done, sin búsqueda/filtro */}
                {group.status && !isDoneCategory && q === '' && !filterFieldId && (
                  <CreateTaskInline
                    projectId={projectId}
                    statusId={group.status.id}
                    onCreated={handleTaskCreated}
                  />
                )}
              </div>
            )}
          </div>
        )
      })}

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

'use client'

/**
 * Vista de Carga de Trabajo (Workload).
 *
 * Agrupa las tareas activas por su asignado principal y muestra, por persona,
 * la carga estimada en horas (a partir de estimate_minutes), el numero de
 * tareas abiertas, las vencidas, y una barra apilada por categoria de estado.
 * Da al lider una lectura rapida de quien esta saturado y quien tiene holgura.
 *
 * Es una vista de solo lectura: al hacer clic en una tarea de la lista expandida
 * se abre el TaskDetailPanel (misma UX que el resto de vistas).
 */
import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ChevronDown, ChevronRight, AlertTriangle, Clock, ListChecks, CheckCircle2, CalendarClock } from 'lucide-react'
import { getInitials } from '@/lib/utils'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { TaskDetailPanel } from './TaskDetailPanel'

interface Status { id: string; name: string; color: string | null; category: string; position: number }
interface Member { id: string; display_name: string; avatar_url: string | null }
interface Task {
  id: string
  title: string
  priority: string
  due_date: string | null
  start_date: string | null
  estimate_minutes: number | null
  sort_order: string
  status: { id: string; name: string; color: string | null; category: string } | null
  assignee: { id: string; display_name: string; avatar_url: string | null } | null
  labels?: { id: string; name: string; color: string }[]
}

interface TaskWorkloadViewProps {
  projectId: string
  tasks: Task[]
  statuses: Status[]
  members: Member[]
  currentUserId: string
}

// Categorias de estado en orden con su color de barra.
const CATEGORY_META: { key: string; label: string; color: string }[] = [
  { key: 'todo', label: 'Por hacer', color: '#94a3b8' },
  { key: 'in_progress', label: 'En progreso', color: '#3b82f6' },
  { key: 'done', label: 'Hecho', color: '#22c55e' },
  { key: 'cancelled', label: 'Cancelado', color: '#64748b' },
]

const PRIORITY_COLOR: Record<string, string> = {
  urgent: '#ef4444', high: '#f97316', medium: '#eab308', low: '#3b82f6', none: '#94a3b8',
}

interface Bucket {
  member: Member | null // null = sin asignar
  tasks: Task[]
  openCount: number
  overdueCount: number
  todayCount: number
  doneCount: number
  estimatedMinutes: number // solo tareas no terminadas
  byCategory: Record<string, number>
}

function startOfToday(): number {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime()
}

function fmtHours(minutes: number): string {
  if (minutes <= 0) return '0h'
  const h = minutes / 60
  if (h < 1) return `${minutes}m`
  return Number.isInteger(h) ? `${h}h` : `${h.toFixed(1)}h`
}

export function TaskWorkloadView({ projectId, tasks, statuses, members, currentUserId }: TaskWorkloadViewProps) {
  const router = useRouter()
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  useRealtimeRefresh({ channel: `proj-load-${projectId}`, tables: ['tasks', 'task_statuses'] })

  const today = startOfToday()

  // Construir buckets por asignado principal, incluyendo el bucket "sin asignar".
  const buckets = useMemo(() => {
    const map = new Map<string, Bucket>()
    const keyFor = (t: Task) => t.assignee?.id ?? '__unassigned__'

    for (const t of tasks) {
      const key = keyFor(t)
      let b = map.get(key)
      if (!b) {
        b = {
          member: t.assignee ?? null,
          tasks: [],
          openCount: 0,
          overdueCount: 0,
          todayCount: 0,
          doneCount: 0,
          estimatedMinutes: 0,
          byCategory: {},
        }
        map.set(key, b)
      }
      b.tasks.push(t)
      const cat = t.status?.category ?? 'todo'
      b.byCategory[cat] = (b.byCategory[cat] ?? 0) + 1
      const isDone = cat === 'done' || cat === 'cancelled'
      if (cat === 'done') b.doneCount += 1
      if (!isDone) {
        b.openCount += 1
        b.estimatedMinutes += t.estimate_minutes ?? 0
        if (t.due_date) {
          // Medianoche local, sin corrimiento por zona horaria.
          const dueDay = new Date(String(t.due_date).slice(0, 10) + 'T00:00:00').getTime()
          if (dueDay < today) b.overdueCount += 1
          else if (dueDay === today) b.todayCount += 1
        }
      }
    }

    const arr = Array.from(map.values())
    // Orden: mas carga estimada primero; "sin asignar" al final.
    arr.sort((a, b) => {
      if (!a.member) return 1
      if (!b.member) return -1
      return b.estimatedMinutes - a.estimatedMinutes || b.openCount - a.openCount
    })
    return arr
  }, [tasks, today])

  // Maximo de minutos estimados entre personas, para escalar las barras de carga.
  const maxMinutes = useMemo(
    () => buckets.reduce((m, b) => Math.max(m, b.estimatedMinutes), 0),
    [buckets],
  )

  const totalOpen = buckets.reduce((s, b) => s + b.openCount, 0)
  const totalOverdue = buckets.reduce((s, b) => s + b.overdueCount, 0)
  const totalToday = buckets.reduce((s, b) => s + b.todayCount, 0)
  const totalDone = buckets.reduce((s, b) => s + b.doneCount, 0)
  const totalMinutes = buckets.reduce((s, b) => s + b.estimatedMinutes, 0)
  const donePct = tasks.length === 0 ? 0 : Math.round((totalDone / tasks.length) * 100)

  function toggle(key: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  if (tasks.length === 0) {
    return (
      <div className="px-6 py-4">
        <p className="mt-6 text-center text-sm text-muted-foreground">No hay tareas en este proyecto todavia.</p>
      </div>
    )
  }

  return (
    <div className="px-6 py-4">
      {selectedTaskId && (
        <TaskDetailPanel
          taskId={selectedTaskId}
          statuses={statuses}
          members={members}
          currentUserId={currentUserId}
          onClose={() => setSelectedTaskId(null)}
          onUpdated={() => router.refresh()}
          onDeleted={() => { setSelectedTaskId(null); router.refresh() }}
          onOpenTask={setSelectedTaskId}
        />
      )}

      {/* Lectura de salud del proyecto (sobre todas las tareas visibles) */}
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
            <span className="tabular-nums">{totalDone}/{tasks.length}</span> completadas
          </span>
          {totalOverdue > 0 && (
            <span className="inline-flex items-center gap-1 text-destructive font-medium">
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="tabular-nums">{totalOverdue}</span> vencidas
            </span>
          )}
          {totalToday > 0 && (
            <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 font-medium">
              <CalendarClock className="w-3.5 h-3.5" />
              <span className="tabular-nums">{totalToday}</span> para hoy
            </span>
          )}
        </div>
      </div>

      {/* Resumen global */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <SummaryCard icon={<ListChecks className="w-4 h-4" />} label="Tareas abiertas" value={String(totalOpen)} />
        <SummaryCard icon={<Clock className="w-4 h-4" />} label="Carga estimada" value={fmtHours(totalMinutes)} />
        <SummaryCard
          icon={<AlertTriangle className="w-4 h-4" />}
          label="Vencidas"
          value={String(totalOverdue)}
          danger={totalOverdue > 0}
        />
      </div>

      {/* Filas por persona */}
      <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
        {buckets.map(b => {
          const key = b.member?.id ?? '__unassigned__'
          const isOpen = expanded.has(key)
          const loadPct = maxMinutes > 0 ? (b.estimatedMinutes / maxMinutes) * 100 : 0
          const name = b.member?.display_name ?? 'Sin asignar'
          return (
            <div key={key} className="bg-background transition-all hover:bg-muted/20">
              {/* Cabecera de la persona */}
              <button
                onClick={() => toggle(key)}
                className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40 transition-colors text-left"
              >
                <span className="text-muted-foreground flex-shrink-0">
                  {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </span>

                {/* Avatar */}
                {b.member?.avatar_url ? (
                  <Image
                    src={b.member.avatar_url}
                    alt={name}
                    width={26}
                    height={26}
                    className="rounded-full object-cover ring-1 ring-border flex-shrink-0"
                  />
                ) : (
                  <span className="w-[26px] h-[26px] rounded-full bg-muted ring-1 ring-border flex items-center justify-center text-[10px] font-medium text-muted-foreground flex-shrink-0">
                    {b.member ? getInitials(name) : '?'}
                  </span>
                )}

                {/* Nombre + barra de carga */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-medium text-foreground truncate">{name}</span>
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {fmtHours(b.estimatedMinutes)} · {b.openCount} {b.openCount === 1 ? 'abierta' : 'abiertas'}
                    </span>
                  </div>
                  {/* Barra apilada por categoria (proporcional a tareas totales de la persona) */}
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden flex">
                      {CATEGORY_META.map(c => {
                        const n = b.byCategory[c.key] ?? 0
                        if (n === 0) return null
                        const pct = (n / b.tasks.length) * 100
                        return (
                          <span
                            key={c.key}
                            title={`${c.label}: ${n}`}
                            style={{ width: `${pct}%`, backgroundColor: c.color }}
                          />
                        )
                      })}
                    </div>
                    {/* Indicador relativo de carga en horas */}
                    <div className="w-16 h-2 rounded-full bg-muted overflow-hidden flex-shrink-0" title="Carga relativa">
                      <span
                        className={`block h-full rounded-full bg-gradient-to-r transition-all duration-500 ${
                          b.overdueCount > 0 ? 'from-amber-500 to-destructive' : 'from-primary to-emerald-500'
                        }`}
                        style={{ width: `${Math.max(loadPct, b.estimatedMinutes > 0 ? 6 : 0)}%` }}
                      />
                    </div>
                  </div>
                </div>

                {/* Alertas por persona */}
                {(b.overdueCount > 0 || b.todayCount > 0) && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {b.overdueCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-1.5 py-0.5 text-[11px] font-medium">
                        <AlertTriangle className="w-3 h-3" />
                        <span className="tabular-nums">{b.overdueCount}</span>
                      </span>
                    )}
                    {b.todayCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 text-[11px] font-medium">
                        <CalendarClock className="w-3 h-3" />
                        <span className="tabular-nums">{b.todayCount}</span>
                      </span>
                    )}
                  </div>
                )}
              </button>

              {/* Lista expandida de tareas de la persona */}
              {isOpen && (
                <div className="pl-11 pr-3 pb-2">
                  {b.tasks.map(t => {
                    const color = t.status?.color ?? PRIORITY_COLOR[t.priority] ?? PRIORITY_COLOR.none
                    const done = t.status?.category === 'done' || t.status?.category === 'cancelled'
                    return (
                      <button
                        key={t.id}
                        onClick={() => setSelectedTaskId(t.id)}
                        className="w-full flex items-center gap-2 py-1.5 text-left group"
                      >
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                        <span className={`text-xs flex-1 truncate ${done ? 'line-through text-muted-foreground' : 'text-foreground group-hover:text-primary'} transition-colors`}>
                          {t.title}
                        </span>
                        {t.estimate_minutes != null && t.estimate_minutes > 0 && (
                          <span className="text-[11px] text-muted-foreground flex-shrink-0">{fmtHours(t.estimate_minutes)}</span>
                        )}
                        {t.status && (
                          <span className="text-[11px] text-muted-foreground flex-shrink-0 hidden sm:inline">{t.status.name}</span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Leyenda de categorias */}
      <div className="flex items-center flex-wrap gap-3 mt-3">
        {CATEGORY_META.map(c => (
          <span key={c.key} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function SummaryCard({ icon, label, value, danger }: { icon: React.ReactNode; label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        <span className={danger ? 'text-red-500' : ''}>{icon}</span>
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className={`text-xl font-semibold ${danger ? 'text-red-500' : 'text-foreground'}`}>{value}</p>
    </div>
  )
}

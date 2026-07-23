/**
 * Mis Tareas, todas las tareas asignadas al usuario en el workspace.
 * Filtros: prioridad, estado, proyecto. Agrupadas por fecha de vencimiento
 * (Vencidas / Hoy / Esta semana / Despues / Sin fecha), lo mas urgente primero.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { timeAgo } from '@/lib/utils'
import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  CircleAlert, ChevronsUp, CheckCircle2, AlertTriangle,
  CalendarClock, CalendarRange, CalendarDays, CircleDashed,
} from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { TaskTimer } from '@/components/tracking/TaskTimer'

interface MyTasksPageProps {
  params: { workspaceSlug: string }
  searchParams: { priority?: string; status_category?: string }
}

type MyTask = {
  id: string
  title: string
  priority: string
  due_date: string | null
  status: { name: string; color: string | null; category: string } | null
  project: {
    name: string
    slug: string
    team: { slug: string } | null
  } | null
}

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0, high: 1, medium: 2, low: 3, none: 4,
}

// ── Buckets por fecha de vencimiento (orden = mas urgente primero) ───────────
type BucketKey = 'vencidas' | 'hoy' | 'esta_semana' | 'despues' | 'sin_fecha'

const BUCKET_ORDER: BucketKey[] = ['vencidas', 'hoy', 'esta_semana', 'despues', 'sin_fecha']

const BUCKET_META: Record<BucketKey, { label: string; icon: ReactNode; tone: string }> = {
  vencidas:    { label: 'Vencidas',     icon: <AlertTriangle className="w-4 h-4" />,  tone: 'text-destructive' },
  hoy:         { label: 'Hoy',          icon: <CalendarClock className="w-4 h-4" />,  tone: 'text-orange-600' },
  esta_semana: { label: 'Esta semana',  icon: <CalendarRange className="w-4 h-4" />,  tone: 'text-foreground' },
  despues:     { label: 'Despues',      icon: <CalendarDays className="w-4 h-4" />,   tone: 'text-muted-foreground' },
  sin_fecha:   { label: 'Sin fecha',    icon: <CircleDashed className="w-4 h-4" />,   tone: 'text-muted-foreground' },
}

/**
 * Funcion pura de bucketing. Compara la fecha de vencimiento (por dia local,
 * ignorando la hora) contra "hoy" para asignar la tarea a un bucket.
 *   - sin_fecha:    due_date nulo
 *   - vencidas:     due_date < hoy
 *   - hoy:          due_date == hoy
 *   - esta_semana:  due_date en los proximos 7 dias (excluye hoy)
 *   - despues:      due_date mas alla de 7 dias
 */
function bucketOf(dueDate: string | null, now: Date): BucketKey {
  if (!dueDate) return 'sin_fecha'
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const d = new Date(dueDate)
  const startOfDue = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const MS_DAY = 86_400_000
  const diffDays = Math.round((startOfDue.getTime() - startOfToday.getTime()) / MS_DAY)
  if (diffDays < 0) return 'vencidas'
  if (diffDays === 0) return 'hoy'
  if (diffDays <= 7) return 'esta_semana'
  return 'despues'
}

/** Orden dentro de un bucket: por fecha de vencimiento asc, luego por prioridad. */
function sortWithinBucket(a: MyTask, b: MyTask): number {
  const da = a.due_date ? new Date(a.due_date).getTime() : Number.POSITIVE_INFINITY
  const db = b.due_date ? new Date(b.due_date).getTime() : Number.POSITIVE_INFINITY
  if (da !== db) return da - db
  const pa = PRIORITY_ORDER[a.priority] ?? 4
  const pb = PRIORITY_ORDER[b.priority] ?? 4
  return pa - pb
}

export default async function MyTasksPage({ params, searchParams }: MyTasksPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // ── Workspace desde membership (anti-RLS-loop) ─────────────────────────────
  type WsFromMember = { workspaces: { id: string; name: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null; error: unknown }

  const workspace = row?.workspaces
  if (!workspace) redirect('/')

  // ── Query de mis tareas ────────────────────────────────────────────────────
  let query = admin
    .from('tasks')
    .select(`
      id, title, priority, due_date,
      status:task_statuses ( name, color, category ),
      project:projects (
        name, slug,
        team:teams ( slug )
      )
    `)
    .eq('workspace_id', workspace.id)
    .eq('assignee_id', user.id)
    .eq('is_archived', false)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(50)

  if (searchParams.priority) {
    query = query.eq('priority', searchParams.priority)
  }

  // ── Mis tareas + timer activo (consultas independientes, en paralelo) ──────
  const [{ data: tasks, error: tasksError }, { data: runningRow }] = await Promise.all([
    query as unknown as Promise<{ data: MyTask[] | null; error: unknown }>,
    admin
      .from('time_entries')
      .select('id, task_id, started_at')
      .eq('profile_id', user.id)
      .is('ended_at', null)
      .maybeSingle(),
  ])

  // Filtrar por categoría de estado si se pide
  let filtered = tasks ?? []
  if (searchParams.status_category) {
    filtered = filtered.filter(t => t.status?.category === searchParams.status_category)
  }

  // ── Agrupar por fecha de vencimiento ───────────────────────────────────────
  const now = new Date()
  const grouped = filtered.reduce<Record<BucketKey, MyTask[]>>((acc, task) => {
    acc[bucketOf(task.due_date, now)].push(task)
    return acc
  }, { vencidas: [], hoy: [], esta_semana: [], despues: [], sin_fecha: [] })

  for (const key of BUCKET_ORDER) grouped[key].sort(sortWithinBucket)

  const visibleBuckets = BUCKET_ORDER.filter(key => grouped[key].length > 0)

  const totalCount = filtered.length
  const overdueCount = grouped.vencidas.filter(t => t.status?.category !== 'done').length

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Mis tareas</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {workspace.name} · {totalCount} tarea{totalCount !== 1 ? 's' : ''}
          {overdueCount > 0 && (
            <span className="ml-2 text-destructive font-medium">
              · {overdueCount} vencida{overdueCount !== 1 ? 's' : ''}
            </span>
          )}
        </p>
      </div>

      {/* Filtros rápidos */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <FilterLink
          href={`/w/${params.workspaceSlug}/my-tasks`}
          label="Todas"
          active={!searchParams.priority && !searchParams.status_category}
        />
        <FilterLink
          href={`/w/${params.workspaceSlug}/my-tasks?status_category=todo`}
          label="Por hacer"
          active={searchParams.status_category === 'todo'}
        />
        <FilterLink
          href={`/w/${params.workspaceSlug}/my-tasks?status_category=in_progress`}
          label="En progreso"
          active={searchParams.status_category === 'in_progress'}
        />
        <FilterLink
          href={`/w/${params.workspaceSlug}/my-tasks?priority=urgent`}
          label={<><CircleAlert className="w-3.5 h-3.5 text-red-600" /> Urgente</>}
          active={searchParams.priority === 'urgent'}
        />
        <FilterLink
          href={`/w/${params.workspaceSlug}/my-tasks?priority=high`}
          label={<><ChevronsUp className="w-3.5 h-3.5 text-orange-600" /> Alta</>}
          active={searchParams.priority === 'high'}
        />
      </div>

      {/* Tareas agrupadas por fecha de vencimiento */}
      {tasksError ? (
        <ErrorState
          title="No pudimos cargar tus tareas"
          description="Ocurrió un problema al leer tus tareas del workspace. Vuelve a intentarlo."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-500" />}
          title="¡Todo al día!"
          description="No tienes tareas asignadas con esos filtros."
        />
      ) : (
        <div className="space-y-6">
          {visibleBuckets.map(key => {
            const meta = BUCKET_META[key]
            return (
              <div key={key}>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`flex items-center gap-1.5 text-sm font-medium ${meta.tone}`}>
                    {meta.icon}
                    {meta.label}
                  </span>
                  <span className="text-xs text-muted-foreground">{grouped[key].length}</span>
                </div>

                <div className="space-y-1.5">
                  {grouped[key].map(task => {
                    const isOverdue = task.due_date &&
                      new Date(task.due_date) < now &&
                      task.status?.category !== 'done'

                    const projectHref = task.project && task.project.team
                      ? `/w/${params.workspaceSlug}/t/${task.project.team.slug}/p/${task.project.slug}`
                      : undefined

                    return (
                      <div
                        key={task.id}
                        className="flex items-center gap-3 bg-card border border-border rounded-lg px-3 py-2.5 hover:border-ring/30 transition-colors"
                      >
                        {/* Status */}
                        <span
                          className="flex-shrink-0 w-2.5 h-2.5 rounded-full"
                          style={{ backgroundColor: task.status?.color ?? '#94a3b8' }}
                          title={task.status?.name}
                        />

                        {/* Título */}
                        <span className={`flex-1 text-sm ${task.status?.category === 'done' ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                          {task.title}
                        </span>

                        {/* Proyecto */}
                        {task.project && (
                          projectHref ? (
                            <Link
                              href={projectHref}
                              className="flex-shrink-0 text-[11px] text-muted-foreground hover:text-foreground transition-colors truncate max-w-[120px]"
                            >
                              {task.project.name}
                            </Link>
                          ) : (
                            <span className="flex-shrink-0 text-[11px] text-muted-foreground truncate max-w-[120px]">
                              {task.project.name}
                            </span>
                          )
                        )}

                        {/* Fecha */}
                        {task.due_date && (
                          <span className={`flex-shrink-0 text-[11px] px-1.5 py-0.5 rounded ${
                            isOverdue
                              ? 'bg-destructive/10 text-destructive'
                              : 'text-muted-foreground'
                          }`}>
                            {timeAgo(task.due_date)}
                          </span>
                        )}

                        {/* Timer de la tarea */}
                        <TaskTimer
                          taskId={task.id}
                          initialRunning={
                            runningRow && runningRow.task_id === task.id
                              ? { id: runningRow.id, started_at: runningRow.started_at }
                              : null
                          }
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterLink({
  href,
  label,
  active,
}: {
  href: string
  label: ReactNode
  active: boolean
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border transition-colors ${
        active
          ? 'bg-primary text-primary-foreground border-transparent'
          : 'bg-background text-muted-foreground border-border hover:text-foreground hover:border-ring'
      }`}
    >
      {label}
    </Link>
  )
}

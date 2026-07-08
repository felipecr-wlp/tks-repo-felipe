/**
 * Mis Tareas — todas las tareas asignadas al usuario en el workspace.
 * Filtros: prioridad, estado, proyecto. Ordenado por fecha de vencimiento.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { timeAgo } from '@/lib/utils'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CircleAlert, ChevronsUp, CheckCircle2 } from 'lucide-react'
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

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-100 text-red-700',
  high:   'bg-orange-100 text-orange-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low:    'bg-blue-100 text-blue-700',
  none:   'bg-muted text-muted-foreground',
}

const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'Urgente', high: 'Alta', medium: 'Media', low: 'Baja', none: 'Sin prioridad',
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

  const { data: tasks } = await query as { data: MyTask[] | null; error: unknown }

  // ── Timer activo del usuario (si lo hay) para pintar el cronometro en vivo ──
  type RunningRow = { id: string; task_id: string | null; started_at: string }
  const { data: runningRow } = await admin
    .from('time_entries')
    .select('id, task_id, started_at')
    .eq('profile_id', user.id)
    .is('ended_at', null)
    .maybeSingle() as { data: RunningRow | null; error: unknown }

  // Filtrar por categoría de estado si se pide
  let filtered = tasks ?? []
  if (searchParams.status_category) {
    filtered = filtered.filter(t => t.status?.category === searchParams.status_category)
  }

  // Agrupar por prioridad para mostrar mejor
  const grouped = filtered.reduce<Record<string, MyTask[]>>((acc, task) => {
    const key = task.priority in PRIORITY_ORDER ? task.priority : 'none'
    if (!acc[key]) acc[key] = []
    acc[key].push(task)
    return acc
  }, {})

  const orderedPriorities = Object.keys(grouped).sort(
    (a, b) => (PRIORITY_ORDER[a] ?? 4) - (PRIORITY_ORDER[b] ?? 4)
  )

  const totalCount = filtered.length
  const overdueCount = filtered.filter(
    t => t.due_date && new Date(t.due_date) < new Date() && t.status?.category !== 'done'
  ).length

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

      {/* Tareas agrupadas por prioridad */}
      {filtered.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle2 className="w-10 h-10 mx-auto mb-3 text-emerald-500" />
          <h3 className="text-sm font-medium text-foreground mb-1">¡Todo al día!</h3>
          <p className="text-sm text-muted-foreground">No tienes tareas pendientes con esos filtros.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {orderedPriorities.map(priority => (
            <div key={priority}>
              <div className="flex items-center gap-2 mb-2">
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${PRIORITY_BADGE[priority]}`}>
                  {PRIORITY_LABEL[priority]}
                </span>
                <span className="text-xs text-muted-foreground">{grouped[priority].length}</span>
              </div>

              <div className="space-y-1.5">
                {grouped[priority].map(task => {
                  const isOverdue = task.due_date &&
                    new Date(task.due_date) < new Date() &&
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
          ))}
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

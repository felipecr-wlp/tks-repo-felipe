/**
 * Dashboard del workspace — overview con teams, mis tareas y actividad.
 * Empty state premium cuando aún no hay teams para guiar al usuario.
 */
import Link from 'next/link'
import Image from 'next/image'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatDate, timeAgo, getInitials } from '@/lib/utils'
import { CheckSquare, CalendarDays, Compass, FileText, LayoutDashboard } from 'lucide-react'
import MiDia from './MiDia'

interface WorkspaceDashboardProps {
  params: { workspaceSlug: string }
}

type ActivityEvent = {
  id: string
  verb: string
  created_at: string
  subject: { display_name: string; avatar_url: string | null } | null
  project: { name: string; slug: string } | null
}

type TaskSummary = {
  id: string
  title: string
  due_date: string | null
  priority: string
  status: { name: string; color: string | null } | null
  project: { name: string; slug: string; team: { slug: string } | null } | null
}

type TeamCard = {
  id: string
  name: string
  slug: string
  projects: Array<{ id: string }>
}

export default async function WorkspaceDashboardPage({
  params,
}: WorkspaceDashboardProps) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // ── Cargar workspace DESDE membership del user ────────────────────────────
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

  // ── Cargar perfil para mostrar nombre ─────────────────────────────────────
  const { data: profile } = await admin
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle() as { data: { display_name: string | null; avatar_url: string | null } | null; error: unknown }

  const userName = profile?.display_name?.split(' ')[0] ??
    user.email?.split('@')[0] ?? 'allá'
  const userAvatar = profile?.avatar_url ?? null

  // ── Cargar teams del usuario en este workspace ────────────────────────────
  const { data: teams } = await admin
    .from('teams')
    .select(`
      id, name, slug,
      team_members!inner ( profile_id ),
      projects ( id )
    `)
    .eq('workspace_id', workspace.id)
    .eq('team_members.profile_id', user.id)
    .order('name', { ascending: true }) as { data: TeamCard[] | null; error: unknown }

  // ── Mis tareas pendientes ─────────────────────────────────────────────────
  const { data: myTasks } = await admin
    .from('tasks')
    .select(`
      id,
      title,
      due_date,
      priority,
      status:task_statuses ( name, color ),
      project:projects ( name, slug, team:teams ( slug ) )
    `)
    .eq('workspace_id', workspace.id)
    .eq('assignee_id', user.id)
    .eq('is_archived', false)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(6) as { data: TaskSummary[] | null; error: unknown }

  // ── Actividad reciente del workspace ──────────────────────────────────────
  const { data: recentActivity } = await admin
    .from('activity_events')
    .select(`
      id,
      verb,
      created_at,
      subject:profiles ( display_name, avatar_url ),
      project:projects ( name, slug )
    `)
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })
    .limit(8) as { data: ActivityEvent[] | null; error: unknown }

  // Indicador de prioridad con color (sin emojis): un punto por nivel.
  const priorityColor: Record<string, string> = {
    urgent: '#ef4444',
    high: '#f97316',
    medium: '#eab308',
    low: '#22c55e',
    none: '',
  }

  const hasTeams = teams && teams.length > 0

  const quickActions = [
    { href: `/w/${params.workspaceSlug}/my-tasks`, label: 'Mis tareas', Icon: CheckSquare },
    { href: `/w/${params.workspaceSlug}/calendar`, label: 'Calendario', Icon: CalendarDays },
    { href: `/w/${params.workspaceSlug}/projects`, label: 'Proyectos', Icon: Compass },
    { href: `/w/${params.workspaceSlug}/notes`, label: 'Notas', Icon: FileText },
  ]

  return (
    <div className="px-8 py-8 max-w-6xl mx-auto">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <div className="mb-8 flex items-center gap-3 sm:gap-4">
        <Link
          href="/settings/profile"
          title="Editar mi perfil"
          className="flex-shrink-0 w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden bg-muted ring-2 ring-border hover:ring-primary/60 transition-all"
        >
          {userAvatar ? (
            <Image
              src={userAvatar}
              alt="Mi avatar"
              width={56}
              height={56}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="flex items-center justify-center w-full h-full text-base font-medium text-muted-foreground">
              {getInitials(profile?.display_name || userName)}
            </span>
          )}
        </Link>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">
            {formatDate(new Date().toISOString())}
          </p>
          <h1 className="text-2xl sm:text-3xl font-semibold text-foreground tracking-tight truncate">
            Hola, {userName}
          </h1>
        </div>
      </div>

      {/* ── Accesos rápidos ──────────────────────────────────────────────── */}
      <div className="mb-10 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {quickActions.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3.5 hover:border-primary/50 hover:shadow-sm transition-all"
          >
            <span className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary/15 transition-colors">
              <Icon size={18} />
            </span>
            <span className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
              {label}
            </span>
          </Link>
        ))}
      </div>

      {/* ── Empty state cuando no hay teams ──────────────────────────────── */}
      {!hasTeams && (
        <div className="mb-8 rounded-2xl border border-border bg-gradient-to-br from-card to-muted/30 p-8">
          <div className="max-w-md">
            <div className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-primary/10 text-primary mb-4">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-foreground mb-1">
              Crea tu primer equipo
            </h2>
            <p className="text-sm text-muted-foreground mb-5">
              Los equipos contienen proyectos y tareas. Puedes tener uno por área
              (Marketing, Producto, Operaciones) o crear el que necesites.
            </p>
            <Link
              href={`/w/${params.workspaceSlug}/teams/new`}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
              Crear equipo
            </Link>
          </div>
        </div>
      )}

      {/* ── Teams del workspace ──────────────────────────────────────────── */}
      {hasTeams && (
        <section className="mb-10">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Equipos
            </h2>
            <Link
              href={`/w/${params.workspaceSlug}/teams/new`}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              + Nuevo equipo
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {teams!.map(team => (
              <div
                key={team.id}
                className="group relative flex flex-col bg-card border border-border rounded-xl p-4 hover:border-primary/50 hover:shadow-sm transition-all"
              >
                <Link
                  href={`/w/${params.workspaceSlug}/t/${team.slug}`}
                  className="flex items-start gap-3"
                >
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center text-sm font-bold">
                    {team.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                      {team.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {team.projects?.length ?? 0}{' '}
                      {(team.projects?.length ?? 0) === 1 ? 'proyecto' : 'proyectos'}
                    </p>
                  </div>
                </Link>
                <Link
                  href={`/w/${params.workspaceSlug}/t/${team.slug}/scrum`}
                  className="mt-3 inline-flex items-center gap-1.5 self-start px-2.5 py-1.5 text-xs font-medium border border-border rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  Tablero
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Mi día (agenda de Google Calendar) ───────────────────────────── */}
      <div className="mb-10">
        <MiDia calendarPath={`/w/${params.workspaceSlug}/calendar`} />
      </div>

      {/* ── Mis tareas + Actividad ───────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Mis tareas — 3 cols */}
        <section className="lg:col-span-3">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Mis tareas
            </h2>
            <Link
              href={`/w/${params.workspaceSlug}/my-tasks`}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Ver todas →
            </Link>
          </div>

          <div className="space-y-1">
            {!myTasks || myTasks.length === 0 ? (
              <div className="bg-muted/20 border border-dashed border-border rounded-xl px-4 py-10 text-center">
                <p className="text-sm text-muted-foreground">
                  {hasTeams
                    ? 'No tienes tareas asignadas'
                    : 'Crea un equipo para empezar a gestionar tareas'}
                </p>
              </div>
            ) : (
              myTasks.map(task => (
                <div
                  key={task.id}
                  className="group flex items-center gap-3 bg-card border border-border rounded-lg px-3 py-2.5 hover:border-primary/30 transition-colors"
                >
                  <span
                    className="flex-shrink-0 w-2 h-2 rounded-full"
                    style={{ backgroundColor: task.status?.color ?? '#94a3b8' }}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-foreground truncate group-hover:text-primary transition-colors">
                      {task.title}
                    </p>
                    {task.project && (
                      <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {task.project.name}
                      </p>
                    )}
                  </div>
                  {task.due_date && (
                    <span className="flex-shrink-0 text-[11px] text-muted-foreground">
                      {timeAgo(task.due_date)}
                    </span>
                  )}
                  {priorityColor[task.priority] && (
                    <span
                      className="flex-shrink-0 w-2 h-2 rounded-full"
                      style={{ backgroundColor: priorityColor[task.priority] }}
                      title={`Prioridad: ${task.priority}`}
                    />
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* Actividad reciente — 2 cols */}
        <section className="lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Actividad
            </h2>
          </div>

          <div className="space-y-0 bg-card border border-border rounded-xl px-3 py-1">
            {!recentActivity || recentActivity.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">
                Sin actividad aún
              </p>
            ) : (
              recentActivity.map(event => (
                <div
                  key={event.id}
                  className="flex items-start gap-2.5 py-2.5 border-b border-border/50 last:border-0"
                >
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                    {event.subject?.display_name?.charAt(0)?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-foreground leading-snug">
                      <span className="font-medium">
                        {event.subject?.display_name ?? 'Usuario'}
                      </span>{' '}
                      <span className="text-muted-foreground">{event.verb}</span>
                      {event.project && (
                        <span className="text-muted-foreground">
                          {' '}en{' '}
                          <span className="text-foreground">{event.project.name}</span>
                        </span>
                      )}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {timeAgo(event.created_at)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

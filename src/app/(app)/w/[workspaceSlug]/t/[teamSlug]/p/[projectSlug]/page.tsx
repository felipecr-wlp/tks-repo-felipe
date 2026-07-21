/**
 * Página del proyecto, vista de lista y kanban de tareas.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { resolveProjectForViewer } from '@/lib/team-access'
import { LayoutDashboard, Zap } from 'lucide-react'
import { ProjectIcon } from '@/lib/project-icons'
import { TaskListView } from '@/components/tasks/TaskListView'
import { TaskCalendarView } from '@/components/tasks/TaskCalendarView'
import { TaskWorkloadView } from '@/components/tasks/TaskWorkloadView'
import { TaskFilterBar } from '@/components/tasks/TaskFilterBar'
import { ProjectChat } from '@/components/chat/ProjectChat'
import { AutomationsPanel } from '@/components/automations/AutomationsPanel'
import { Skeleton } from '@/components/ui/Skeleton'

// Kanban cargado lazy, contiene @dnd-kit que pesa ~150KB
const KanbanBoard = dynamic(
  () => import('@/components/tasks/KanbanBoard').then(m => m.KanbanBoard),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex gap-4 px-6 py-4 overflow-hidden">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="flex-1 min-w-[260px] flex flex-col gap-3">
            <Skeleton className="h-4 w-24" />
            {Array.from({ length: 3 }).map((_, card) => (
              <Skeleton key={card} className="h-24 w-full rounded-lg" />
            ))}
          </div>
        ))}
      </div>
    ),
  }
)

interface ProjectPageProps {
  params: {
    workspaceSlug: string
    teamSlug: string
    projectSlug: string
  }
  searchParams: { view?: string; status?: string; assignee?: string; priority?: string; task?: string }
}

type StatusRow = {
  id: string
  name: string
  color: string | null
  category: string
  position: number
}

type TaskLabel = { id: string; name: string; color: string }

type TaskRow = {
  id: string
  title: string
  priority: string
  due_date: string | null
  start_date: string | null
  estimate_minutes: number | null
  sort_order: string
  recurrence_rule: string | null
  status: { id: string; name: string; color: string | null; category: string } | null
  assignee: { id: string; display_name: string; avatar_url: string | null } | null
  assignees: { id: string; display_name: string | null; avatar_url: string | null }[]
  labels: TaskLabel[]
  subtaskTotal?: number
  subtaskDone?: number
}

// Forma cruda de Supabase antes de aplanar etiquetas y asignados.
type AssigneeJoinRow = {
  profile: { id: string; display_name: string | null; avatar_url: string | null } | null
}
type TaskRowRaw = Omit<TaskRow, 'labels' | 'assignees' | 'subtaskTotal' | 'subtaskDone'> & {
  labels: { label: TaskLabel | null }[] | null
  task_assignees: AssigneeJoinRow[] | null
}

export default async function ProjectPage({
  params,
  searchParams,
}: ProjectPageProps) {
  // Acceso: miembro del proyecto O admin del workspace (empareja el sidebar).
  const res = await resolveProjectForViewer(
    params.workspaceSlug,
    params.teamSlug,
    params.projectSlug,
  )
  if (!res.ok && res.reason === 'no-auth') redirect('/auth/login')
  if (!res.ok) notFound()
  const { userId, project, role, isAdmin } = res.ctx

  // ¿Puede administrar reglas de automatización? (manager/lead/admin del
  // proyecto o admin del workspace). Gatea la pestaña "Reglas".
  const canManage = isAdmin || ['owner', 'admin', 'lead', 'manager'].includes(role ?? '')

  const admin = createAdminClient()

  // ── Cargar estados, tareas y miembros (admin client, acceso ya validado) ─
  const { data: statuses } = await admin
    .from('task_statuses')
    .select('id, name, color, category, position')
    .eq('project_id', project.id)
    .order('position', { ascending: true }) as { data: StatusRow[] | null; error: unknown }

  // ── Cargar tareas (paginado: 50 max, egress optimizado) ───────────────────
  let query = admin
    .from('tasks')
    .select(`
      id,
      title,
      priority,
      due_date,
      start_date,
      estimate_minutes,
      sort_order,
      recurrence_rule,
      status:task_statuses ( id, name, color, category ),
      assignee:profiles!tasks_assignee_id_fkey ( id, display_name, avatar_url ),
      task_assignees ( profile:profiles ( id, display_name, avatar_url ) ),
      labels:task_labels ( label:labels ( id, name, color ) )
    `)
    .eq('project_id', project.id)
    .eq('is_archived', false)
    .is('parent_task_id', null)
    .order('sort_order', { ascending: true })
    .limit(50)

  if (searchParams.status) {
    query = query.eq('status_id', searchParams.status)
  }
  if (searchParams.priority) {
    query = query.eq('priority', searchParams.priority)
  }
  if (searchParams.assignee) {
    query = query.eq('assignee_id', searchParams.assignee)
  }

  const { data: tasksRaw } = await query as { data: TaskRowRaw[] | null; error: unknown }

  // Aplanar etiquetas (task_labels -> label) y asignados (task_assignees -> profile).
  const tasks: TaskRow[] = (tasksRaw ?? []).map(t => {
    const { labels: rawLabels, task_assignees: rawAssignees, ...rest } = t
    return {
      ...rest,
      labels: (rawLabels ?? [])
        .map(r => r.label)
        .filter((l): l is { id: string; name: string; color: string } => l != null),
      assignees: (rawAssignees ?? [])
        .map(r => r.profile)
        .filter((p): p is { id: string; display_name: string | null; avatar_url: string | null } => p != null),
    }
  })

  // ── Progreso de subtareas: contar hijas (total + completadas) por padre ───
  // Una sola consulta acotada al proyecto; se agrega en JS a un mapa padre -> {total, done}.
  type SubtaskCountRow = {
    parent_task_id: string
    status: { category: string } | null
  }
  const parentIds = tasks.map(t => t.id)
  if (parentIds.length > 0) {
    const { data: subRows } = await admin
      .from('tasks')
      .select('parent_task_id, status:task_statuses ( category )')
      .in('parent_task_id', parentIds)
      .eq('is_archived', false) as { data: SubtaskCountRow[] | null; error: unknown }

    const counts = new Map<string, { total: number; done: number }>()
    for (const s of subRows ?? []) {
      if (!s.parent_task_id) continue
      const c = counts.get(s.parent_task_id) ?? { total: 0, done: 0 }
      c.total += 1
      if (s.status?.category === 'done') c.done += 1
      counts.set(s.parent_task_id, c)
    }
    for (const t of tasks) {
      const c = counts.get(t.id)
      if (c) {
        t.subtaskTotal = c.total
        t.subtaskDone = c.done
      }
    }
  }

  // ── Miembros del proyecto (para asignar tareas) ───────────────────────────
  type MemberRow = {
    profile: { id: string; display_name: string; avatar_url: string | null } | null
  }
  const { data: members } = await admin
    .from('project_members')
    .select('profile:profiles ( id, display_name, avatar_url )')
    .eq('project_id', project.id) as { data: MemberRow[] | null; error: unknown }

  const memberProfiles = (members ?? [])
    .filter(m => m.profile != null)
    .map(m => m.profile!)

  // ── Vistas guardadas del usuario en este proyecto (filtros nombrados) ─────
  type SavedViewRow = {
    id: string
    name: string
    filters: { view?: string; status?: string; priority?: string; assignee?: string }
  }
  const { data: savedViews } = await admin
    .from('task_saved_views')
    .select('id, name, filters')
    .eq('project_id', project.id)
    .eq('profile_id', userId)
    .order('created_at', { ascending: true }) as { data: SavedViewRow[] | null; error: unknown }

  const currentView = searchParams.view ?? 'list'
  const basePath = `/w/${params.workspaceSlug}/t/${params.teamSlug}/p/${params.projectSlug}`

  // Chat del proyecto: historial (ultimos 100) solo si la pestana esta activa.
  type ProjectMessageRow = { id: string; author_id: string; body: string; created_at: string }
  type ReactionRow = { id: string; message_id: string; profile_id: string; emoji: string }
  let chatMessages: ProjectMessageRow[] = []
  let chatReactions: ReactionRow[] = []
  if (currentView === 'chat') {
    const { data: msgs } = await admin
      .from('project_messages')
      .select('id, author_id, body, created_at')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(100) as { data: ProjectMessageRow[] | null; error: unknown }
    chatMessages = (msgs ?? []).reverse()

    // Reacciones SOLO de los mensajes cargados (antes traía todas las del
    // proyecto, creciendo sin límite con el historial).
    if (chatMessages.length > 0) {
      const { data: reacts } = await admin
        .from('message_reactions')
        .select('id, message_id, profile_id, emoji')
        .eq('project_id', project.id)
        .in('message_id', chatMessages.map(m => m.id)) as { data: ReactionRow[] | null; error: unknown }
      chatReactions = reacts ?? []
    }
  }

  // ── Automatizaciones (Circuito 3.C): reglas + sprints para el editor ──────
  type AutomationRuleRow = {
    id: string; name: string; trigger: string
    trigger_config: { to_status_id?: string; to_assignee_id?: string }
    conditions: unknown[]; actions: unknown[]; is_active: boolean; created_at: string
  }
  type SprintRow = { id: string; name: string; status: string }
  let automationRules: AutomationRuleRow[] = []
  let sprintList: SprintRow[] = []
  if (currentView === 'automations' && canManage) {
    const [{ data: rules }, { data: sp }] = await Promise.all([
      admin
        .from('automations')
        .select('id, name, trigger, trigger_config, conditions, actions, is_active, created_at')
        .eq('project_id', project.id)
        .order('created_at', { ascending: true }),
      admin
        .from('sprints')
        .select('id, name, status')
        .eq('team_id', project.team_id)
        .neq('status', 'completed')
        .order('created_at', { ascending: false }),
    ]) as [{ data: AutomationRuleRow[] | null }, { data: SprintRow[] | null }]
    automationRules = rules ?? []
    sprintList = sp ?? []
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header del proyecto: breadcrumb compacto + tabs (estilo Linear) ── */}
      <div className="px-6 pt-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 min-w-0 text-sm">
            <Link
              href={`/w/${params.workspaceSlug}`}
              className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[140px]"
            >
              {project.workspace?.name}
            </Link>
            <span className="text-muted-foreground/40">/</span>
            <Link
              href={`/w/${params.workspaceSlug}/t/${params.teamSlug}`}
              className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[140px]"
            >
              {project.team?.name}
            </Link>
            <span className="text-muted-foreground/40">/</span>
            <ProjectIcon icon={project.icon} size={16} className="text-muted-foreground flex-shrink-0" />
            <h1 className="text-sm font-semibold text-foreground truncate">{project.name}</h1>
          </div>

          {/* Acceso discreto a Planeación del equipo (Scrum/Kanban) */}
          <Link
            href={`/w/${params.workspaceSlug}/t/${params.teamSlug}/scrum`}
            className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
            title="Planeación del equipo (Scrum/Kanban)"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Planeación</span>
          </Link>
        </div>

        {/* Tabs de vista con subrayado */}
        <nav className="flex items-center gap-1 mt-1 overflow-x-auto scrollbar-none" aria-label="Vistas del proyecto">
          <ViewToggle href={`${basePath}?view=list`} active={currentView === 'list'} label="Lista" icon={<ListIcon />} />
          <ViewToggle href={`${basePath}?view=board`} active={currentView === 'board'} label="Tablero" icon={<BoardIcon />} />
          <ViewToggle href={`${basePath}?view=calendar`} active={currentView === 'calendar'} label="Calendario" icon={<CalIcon />} />
          <ViewToggle href={`${basePath}?view=workload`} active={currentView === 'workload'} label="Carga" icon={<LoadIcon />} />
          <ViewToggle href={`${basePath}?view=chat`} active={currentView === 'chat'} label="Chat" icon={<ChatIcon />} />
          {canManage && (
            <ViewToggle href={`${basePath}?view=automations`} active={currentView === 'automations'} label="Reglas" icon={<Zap className="w-[13px] h-[13px]" />} />
          )}
        </nav>
      </div>

      {/* ── Barra de filtros + vistas guardadas (no aplica al chat ni reglas) ──── */}
      {currentView !== 'chat' && currentView !== 'automations' && (
        <TaskFilterBar
          basePath={basePath}
          projectId={project.id}
          currentView={currentView}
          statuses={statuses ?? []}
          members={memberProfiles}
          current={{
            status: searchParams.status,
            priority: searchParams.priority,
            assignee: searchParams.assignee,
          }}
          savedViews={savedViews ?? []}
        />
      )}

      {/* ── Vista de tareas (lista, kanban, calendario) o chat ──────── */}
      <div key={currentView} className={`flex-1 min-h-0 animate-in fade-in duration-200 ${currentView === 'chat' ? 'flex flex-col' : 'overflow-auto'}`}>
        {currentView === 'chat' ? (
          <ProjectChat
            projectId={project.id}
            currentUserId={userId}
            members={memberProfiles}
            initialMessages={chatMessages}
            initialReactions={chatReactions}
          />
        ) : currentView === 'automations' ? (
          canManage ? (
            <AutomationsPanel
              projectId={project.id}
              statuses={(statuses ?? []).map(s => ({ id: s.id, name: s.name, category: s.category }))}
              members={memberProfiles}
              sprints={sprintList}
              initialRules={automationRules.map(r => ({
                id: r.id,
                name: r.name,
                trigger: r.trigger as 'status_changed' | 'assigned' | 'task_created' | 'due',
                trigger_config: r.trigger_config ?? {},
                conditions: r.conditions ?? [],
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                actions: (r.actions ?? []) as any,
                is_active: r.is_active,
                created_at: r.created_at,
              }))}
            />
          ) : (
            <div className="px-6 py-10 text-center text-sm text-muted-foreground">
              No tienes permiso para administrar las reglas de este proyecto.
            </div>
          )
        ) : currentView === 'board' ? (
          <KanbanBoard
            projectId={project.id}
            tasks={tasks ?? []}
            statuses={statuses ?? []}
            members={memberProfiles}
            currentUserId={userId}
            initialTaskId={searchParams.task}
          />
        ) : currentView === 'calendar' ? (
          <TaskCalendarView
            projectId={project.id}
            tasks={tasks ?? []}
            statuses={statuses ?? []}
            members={memberProfiles}
            currentUserId={userId}
          />
        ) : currentView === 'workload' ? (
          <TaskWorkloadView
            projectId={project.id}
            tasks={tasks ?? []}
            statuses={statuses ?? []}
            members={memberProfiles}
            currentUserId={userId}
          />
        ) : (
          <TaskListView
            projectId={project.id}
            projectSlug={project.slug}
            workspaceSlug={params.workspaceSlug}
            teamSlug={params.teamSlug}
            tasks={tasks ?? []}
            statuses={statuses ?? []}
            members={memberProfiles}
            currentUserId={userId}
            initialTaskId={searchParams.task}
          />
        )}
      </div>
    </div>
  )
}

function ViewToggle({
  href,
  active,
  label,
  icon,
}: {
  href: string
  active: boolean
  label: string
  icon: React.ReactNode
}) {
  return (
    <Link
      href={href}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 text-xs border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'border-primary text-foreground font-medium'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Link>
  )
}

function ListIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 3.5h9M2 6.5h9M2 9.5h9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function BoardIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <rect x="1" y="2" width="3.5" height="9" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="4.75" y="2" width="3.5" height="6" rx="1" stroke="currentColor" strokeWidth="1.3" />
      <rect x="8.5" y="2" width="3.5" height="7.5" rx="1" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

function ChatIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 3.5A1.5 1.5 0 0 1 3.5 2h6A1.5 1.5 0 0 1 11 3.5v3A1.5 1.5 0 0 1 9.5 8H5l-2.5 2.5V8H3.5A1.5 1.5 0 0 1 2 6.5v-3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  )
}

function CalIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <rect x="1.5" y="2.5" width="10" height="8.5" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
      <path d="M1.5 5h10M4 1.5v2M9 1.5v2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}

function LoadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2 11V6M6.5 11V2M11 11V8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

/**
 * Página del proyecto, vista de lista y kanban de tareas.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { LayoutDashboard } from 'lucide-react'
import { ProjectIcon } from '@/lib/project-icons'
import { TaskListView } from '@/components/tasks/TaskListView'
import { ProjectChat } from '@/components/chat/ProjectChat'

// Kanban cargado lazy, contiene @dnd-kit que pesa ~150KB
const KanbanBoard = dynamic(
  () => import('@/components/tasks/KanbanBoard').then(m => m.KanbanBoard),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        Cargando tablero...
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
  searchParams: { view?: string; status?: string; assignee?: string }
}

type ProjectData = {
  id: string
  name: string
  slug: string
  icon: string | null
  description: string | null
  workspace_id: string
  team_id: string
  team: { id: string; name: string; slug: string } | null
  workspace: { id: string; name: string } | null
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
  sort_order: string
  status: { id: string; name: string; color: string | null; category: string } | null
  assignee: { id: string; display_name: string; avatar_url: string | null } | null
  labels: TaskLabel[]
}

// Forma cruda de Supabase antes de aplanar las etiquetas.
type TaskRowRaw = Omit<TaskRow, 'labels'> & {
  labels: { label: TaskLabel | null }[] | null
}

export default async function ProjectPage({
  params,
  searchParams,
}: ProjectPageProps) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // ── Lookup atómico: proyecto desde la membership del usuario ──────────────
  // Mismo patrón que workspace layout, evita loops de RLS y ambigüedad de slug.
  type ProjectFromMember = {
    role: string
    projects: ProjectData | null
  }

  const { data: row } = await admin
    .from('project_members')
    .select(`
      role,
      projects!inner (
        id, name, slug, icon, description, workspace_id, team_id,
        team:teams ( id, name, slug ),
        workspace:workspaces ( id, name )
      )
    `)
    .eq('profile_id', user.id)
    .eq('projects.slug', params.projectSlug)
    .limit(1)
    .maybeSingle() as { data: ProjectFromMember | null; error: unknown }

  if (!row || !row.projects) notFound()

  const project = row.projects

  // Verificar coherencia con team de la URL
  if (project.team?.slug !== params.teamSlug) {
    notFound()
  }

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
      sort_order,
      status:task_statuses ( id, name, color, category ),
      assignee:profiles ( id, display_name, avatar_url ),
      labels:task_labels ( label:labels ( id, name, color ) )
    `)
    .eq('project_id', project.id)
    .eq('is_archived', false)
    .order('sort_order', { ascending: true })
    .limit(50)

  if (searchParams.status) {
    query = query.eq('status_id', searchParams.status)
  }

  const { data: tasksRaw } = await query as { data: TaskRowRaw[] | null; error: unknown }

  // Aplanar etiquetas: task_labels -> label -> { id, name, color }
  const tasks: TaskRow[] = (tasksRaw ?? []).map(t => {
    const { labels: rawLabels, ...rest } = t
    return {
      ...rest,
      labels: (rawLabels ?? [])
        .map(r => r.label)
        .filter((l): l is { id: string; name: string; color: string } => l != null),
    }
  })

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

  const currentView = searchParams.view ?? 'list'

  // Chat del proyecto: historial (ultimos 100) solo si la pestana esta activa.
  type ProjectMessageRow = { id: string; author_id: string; body: string; created_at: string }
  let chatMessages: ProjectMessageRow[] = []
  if (currentView === 'chat') {
    const { data: msgs } = await admin
      .from('project_messages')
      .select('id, author_id, body, created_at')
      .eq('project_id', project.id)
      .order('created_at', { ascending: false })
      .limit(100) as { data: ProjectMessageRow[] | null; error: unknown }
    chatMessages = (msgs ?? []).reverse()
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Header del proyecto ───────────────────────────────────── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-background sticky top-0 z-10">
        <div>
          <p className="text-xs text-muted-foreground mb-0.5">
            <Link href={`/w/${params.workspaceSlug}`} className="hover:text-foreground transition-colors">
              {project.workspace?.name}
            </Link>
            {' / '}
            <Link
              href={`/w/${params.workspaceSlug}/t/${params.teamSlug}`}
              className="hover:text-foreground transition-colors"
            >
              {project.team?.name}
            </Link>
          </p>
          <div className="flex items-center gap-2">
            <ProjectIcon icon={project.icon} size={18} className="text-muted-foreground" />
            <h1 className="text-lg font-semibold text-foreground">{project.name}</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Acceso a Planeación del equipo (Scrum/Kanban) */}
          <Link
            href={`/w/${params.workspaceSlug}/t/${params.teamSlug}/scrum`}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-border text-foreground text-xs font-medium rounded-md hover:bg-muted transition-colors"
            title="Planeación del equipo (Scrum/Kanban)"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Planeación del equipo</span>
          </Link>

          {/* View switcher */}
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            <ViewToggle
              href={`/w/${params.workspaceSlug}/t/${params.teamSlug}/p/${params.projectSlug}?view=list`}
              active={currentView === 'list'}
              label="Lista"
              icon={<ListIcon />}
            />
            <ViewToggle
              href={`/w/${params.workspaceSlug}/t/${params.teamSlug}/p/${params.projectSlug}?view=board`}
              active={currentView === 'board'}
              label="Tablero"
              icon={<BoardIcon />}
            />
            <ViewToggle
              href={`/w/${params.workspaceSlug}/t/${params.teamSlug}/p/${params.projectSlug}?view=chat`}
              active={currentView === 'chat'}
              label="Chat"
              icon={<ChatIcon />}
            />
          </div>
        </div>
      </div>

      {/* ── Vista de tareas (lista, kanban) o chat del proyecto ──────── */}
      <div className={`flex-1 min-h-0 ${currentView === 'chat' ? 'flex flex-col' : 'overflow-auto'}`}>
        {currentView === 'chat' ? (
          <ProjectChat
            projectId={project.id}
            currentUserId={user.id}
            members={memberProfiles}
            initialMessages={chatMessages}
          />
        ) : currentView === 'board' ? (
          <KanbanBoard
            projectId={project.id}
            tasks={tasks ?? []}
            statuses={statuses ?? []}
            members={memberProfiles}
            currentUserId={user.id}
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
            currentUserId={user.id}
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
      className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
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

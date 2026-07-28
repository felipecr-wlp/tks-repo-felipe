/**
 * Cronograma (Gantt) a nivel EQUIPO.
 *
 * Agrega las tareas de TODOS los proyectos no archivados del equipo en un solo
 * eje de tiempo (agrupadas por proyecto). El Gantt por proyecto vive en
 * .../p/[projectSlug]?view=timeline; este es su equivalente para el equipo.
 */
import { createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { resolveTeamForViewer } from '@/lib/team-access'
import { TeamTimelineView } from '@/components/tasks/TeamTimelineView'

interface CronogramaPageProps {
  params: { workspaceSlug: string; teamSlug: string }
}

type ProjectRow = { id: string; name: string; slug: string; icon: string | null }

type TaskRowRaw = {
  id: string
  title: string
  priority: string
  due_date: string | null
  start_date: string | null
  project_id: string
  status: { category: string; color: string | null } | null
  assignee: { display_name: string; avatar_url: string | null } | null
}

export default async function CronogramaPage({ params }: CronogramaPageProps) {
  const res = await resolveTeamForViewer(params.workspaceSlug, params.teamSlug)
  if (!res.ok && res.reason === 'no-auth') redirect('/auth/login')
  if (!res.ok) notFound()
  const { workspace, team } = res.ctx

  const admin = createAdminClient()

  // ── Proyectos no archivados del equipo ──────────────────────────────────
  const { data: projects } = await admin
    .from('projects')
    .select('id, name, slug, icon')
    .eq('team_id', team.id)
    .eq('is_archived', false)
    .order('name', { ascending: true }) as { data: ProjectRow[] | null; error: unknown }

  const projectMap = new Map<string, ProjectRow>()
  for (const p of projects ?? []) projectMap.set(p.id, p)
  const projectIds = Array.from(projectMap.keys())

  // ── Tareas de nivel superior (no subtareas) de todos esos proyectos ──────
  let tasks: {
    id: string
    title: string
    priority: string
    due_date: string | null
    start_date: string | null
    status: { category: string; color: string | null } | null
    assignee: { display_name: string; avatar_url: string | null } | null
    project: ProjectRow
  }[] = []

  if (projectIds.length > 0) {
    const { data: tasksRaw } = await admin
      .from('tasks')
      .select(`
        id,
        title,
        priority,
        due_date,
        start_date,
        project_id,
        status:task_statuses ( category, color ),
        assignee:profiles!tasks_assignee_id_fkey ( display_name, avatar_url )
      `)
      .in('project_id', projectIds)
      .eq('is_archived', false)
      .is('parent_task_id', null)
      .order('start_date', { ascending: true, nullsFirst: false })
      .limit(500) as { data: TaskRowRaw[] | null; error: unknown }

    tasks = (tasksRaw ?? [])
      .map(t => {
        const project = projectMap.get(t.project_id)
        if (!project) return null
        return {
          id: t.id,
          title: t.title,
          priority: t.priority,
          due_date: t.due_date,
          start_date: t.start_date,
          status: t.status,
          assignee: t.assignee,
          project,
        }
      })
      .filter((x): x is NonNullable<typeof x> => x != null)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header compacto con breadcrumb */}
      <div className="px-6 pt-3 pb-2 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-1.5 min-w-0 text-sm">
          <Link
            href={`/w/${params.workspaceSlug}`}
            className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[140px]"
          >
            {workspace.name}
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <Link
            href={`/w/${params.workspaceSlug}/t/${params.teamSlug}`}
            className="text-muted-foreground hover:text-foreground transition-colors truncate max-w-[160px]"
          >
            {team.name}
          </Link>
          <span className="text-muted-foreground/40">/</span>
          <h1 className="text-sm font-semibold text-foreground truncate">Cronograma</h1>
          <Link
            href={`/w/${params.workspaceSlug}/t/${params.teamSlug}`}
            className="ml-auto flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground rounded-md hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Volver al equipo</span>
          </Link>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        <TeamTimelineView
          teamId={team.id}
          projectIds={projectIds}
          workspaceSlug={params.workspaceSlug}
          teamSlug={params.teamSlug}
          teamName={team.name}
          workspaceName={workspace.name}
          tasks={tasks}
        />
      </div>
    </div>
  )
}

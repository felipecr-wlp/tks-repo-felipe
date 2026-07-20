/**
 * /w/[workspaceSlug]/t/[teamSlug]/scrum, Capa SCRUM del equipo.
 *
 * Server Component: valida acceso al equipo, carga sprints + tareas de TODOS
 * los proyectos del equipo (con su capa scrum) y delega la interacción al
 * cliente ScrumWorkspace (tablero, backlog, daily, dashboard). No reinventa
 * el task engine: lee de las mismas tablas (tasks / task_statuses).
 */
import { createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { resolveTeamForViewer } from '@/lib/team-access'
import { ScrumWorkspace } from '@/components/scrum/ScrumWorkspace'
import type { ScrumTask, ScrumSprint, ScrumMember, ScrumStatus } from '@/components/scrum/types'

interface ScrumPageProps {
  params: { workspaceSlug: string; teamSlug: string }
}

export const metadata = { title: 'Scrum · WLO' }

export default async function ScrumPage({ params }: ScrumPageProps) {
  const res = await resolveTeamForViewer(params.workspaceSlug, params.teamSlug)
  if (!res.ok && res.reason === 'no-auth') redirect('/auth/login')
  if (!res.ok) notFound()
  const { userId, workspace, team } = res.ctx

  const admin = createAdminClient()

  // ── Proyectos del equipo ──────────────────────────────────────────────────
  type ProjRow = { id: string; name: string; slug: string; icon: string | null }
  const { data: projects } = await admin
    .from('projects')
    .select('id, name, slug, icon')
    .eq('team_id', team.id)
    .eq('is_archived', false) as { data: ProjRow[] | null; error: unknown }

  const projectIds = (projects ?? []).map(p => p.id)
  const projectName = new Map((projects ?? []).map(p => [p.id, p.name]))

  // ── Sprints del equipo ────────────────────────────────────────────────────
  const { data: sprintsRaw } = await admin
    .from('sprints')
    .select('id, name, goal, status, start_date, end_date, created_at')
    .eq('team_id', team.id)
    .order('start_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false }) as { data: ScrumSprint[] | null; error: unknown }

  // ── Estados (para mapear movimientos por categoría) ───────────────────────
  // ── Tareas de todos los proyectos del equipo (incluye capa scrum) ─────────
  let tasks: ScrumTask[] = []
  let statuses: ScrumStatus[] = []
  if (projectIds.length > 0) {
    type TaskRow = {
      id: string; title: string; priority: string; due_date: string | null
      updated_at: string; project_id: string
      sprint_id: string | null; story_points: number | null
      story_points_done: number | null; area: string | null
      status: { id: string; name: string; color: string | null; category: string } | null
      assignee: { id: string; display_name: string; avatar_url: string | null } | null
    }
    const { data: taskRows } = await admin
      .from('tasks')
      .select(`
        id, title, priority, due_date, updated_at, project_id,
        sprint_id, story_points, story_points_done, area,
        status:task_statuses ( id, name, color, category ),
        assignee:profiles!tasks_assignee_id_fkey ( id, display_name, avatar_url )
      `)
      .in('project_id', projectIds)
      .eq('is_archived', false)
      .limit(2000) as { data: TaskRow[] | null; error: unknown }

    tasks = (taskRows ?? []).map(t => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      due_date: t.due_date,
      updated_at: t.updated_at,
      project_id: t.project_id,
      project_name: projectName.get(t.project_id) ?? 'Proyecto',
      sprint_id: t.sprint_id,
      story_points: t.story_points,
      story_points_done: t.story_points_done,
      area: t.area,
      status: t.status,
      assignee: t.assignee,
    }))

    const { data: statusRows } = await admin
      .from('task_statuses')
      .select('id, project_id, name, color, category, position')
      .in('project_id', projectIds)
      .order('position', { ascending: true }) as { data: ScrumStatus[] | null; error: unknown }
    statuses = statusRows ?? []
  }

  // ── Miembros del equipo ───────────────────────────────────────────────────
  type MemberRow = {
    role: string
    profile: { id: string; display_name: string; avatar_url: string | null } | null
  }
  const { data: memberRows } = await admin
    .from('team_members')
    .select('role, profile:profiles ( id, display_name, avatar_url )')
    .eq('team_id', team.id) as { data: MemberRow[] | null; error: unknown }

  const members: ScrumMember[] = (memberRows ?? [])
    .filter(m => m.profile != null)
    .map(m => ({ ...m.profile!, role: m.role }))

  // Puente de contexto: cuando el equipo tiene UN solo proyecto, la Planeación y
  // el tablero del proyecto se leen redundantes. Le pasamos el enlace al proyecto
  // para que el workspace aclare la diferencia (Planeación = sprints/flujo del
  // equipo; el proyecto tiene sus estados detallados).
  const soloProject =
    (projects ?? []).length === 1
      ? {
          name: projects![0].name,
          href: `/w/${params.workspaceSlug}/t/${params.teamSlug}/p/${projects![0].slug}`,
        }
      : null

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-4">
        <p className="text-xs text-muted-foreground mb-0.5">
          <Link href={`/w/${params.workspaceSlug}`} className="hover:text-foreground transition-colors">
            {workspace.name}
          </Link>
          {' / '}
          <Link
            href={`/w/${params.workspaceSlug}/t/${params.teamSlug}`}
            className="hover:text-foreground transition-colors"
          >
            {team.name}
          </Link>
        </p>
      </div>
      <ScrumWorkspace
        teamId={team.id}
        workspaceId={workspace.id}
        teamName={team.name}
        methodology={team.methodology === 'kanban' ? 'kanban' : 'scrum'}
        sprints={sprintsRaw ?? []}
        tasks={tasks}
        statuses={statuses}
        members={members}
        currentUserId={userId}
        soloProject={soloProject}
      />
    </div>
  )
}

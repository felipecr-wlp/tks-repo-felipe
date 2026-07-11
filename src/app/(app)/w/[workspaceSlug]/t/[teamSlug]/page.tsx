/**
 * Página del equipo, lista proyectos del equipo y acceso rápido.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { LayoutDashboard, FolderKanban, Plus, ListChecks, MessageSquare, Maximize2 } from 'lucide-react'
import { ProjectIcon } from '@/lib/project-icons'
import { TeamChat } from '@/components/chat/TeamChat'

interface TeamPageProps {
  params: { workspaceSlug: string; teamSlug: string }
}

type ProjectRow = {
  id: string
  name: string
  slug: string
  icon: string | null
  description: string | null
  status: 'active' | 'archived' | 'on_hold'
  _count?: { tasks: number }
}

export default async function TeamPage({ params }: TeamPageProps) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // ── Workspace + team desde membership (anti-RLS-loop) ────────────────────
  type WsFromMember = { workspaces: { id: string; name: string } | null }
  const { data: wsRow } = await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null; error: unknown }

  const workspace = wsRow?.workspaces
  if (!workspace) redirect('/')

  // ── Team desde membership ─────────────────────────────────────────────────
  type TeamFromMember = {
    role: string
    teams: { id: string; name: string; description: string | null; workspace_id: string } | null
  }
  const { data: teamRow } = await admin
    .from('team_members')
    .select(`
      role,
      teams!inner ( id, name, description, workspace_id )
    `)
    .eq('profile_id', user.id)
    .eq('teams.slug', params.teamSlug)
    .eq('teams.workspace_id', workspace.id)
    .limit(1)
    .maybeSingle() as { data: TeamFromMember | null; error: unknown }

  if (!teamRow || !teamRow.teams) {
    notFound()
  }
  const team = teamRow.teams

  // ── Cargar proyectos del equipo (admin, acceso ya validado) ─────────────
  const { data: projects } = await admin
    .from('projects')
    .select('id, name, slug, icon, description, status')
    .eq('team_id', team.id)
    .eq('is_archived', false)
    .order('name', { ascending: true }) as { data: ProjectRow[] | null; error: unknown }

  // ── Conteo de tareas activas por proyecto (para mostrar "trabajo real") ──
  const taskCount = new Map<string, number>()
  const projIds = (projects ?? []).map(p => p.id)
  if (projIds.length > 0) {
    const { data: taskRows } = await admin
      .from('tasks')
      .select('project_id')
      .in('project_id', projIds)
      .eq('is_archived', false) as { data: { project_id: string }[] | null; error: unknown }
    for (const t of taskRows ?? []) {
      taskCount.set(t.project_id, (taskCount.get(t.project_id) ?? 0) + 1)
    }
  }

  // ── Chat general del equipo: miembros (autores) + historial reciente ──────
  type MemberRow = {
    profile: { id: string; display_name: string; avatar_url: string | null } | null
  }
  const { data: memberRows } = await admin
    .from('team_members')
    .select('profile:profiles ( id, display_name, avatar_url )')
    .eq('team_id', team.id) as { data: MemberRow[] | null; error: unknown }

  const members = (memberRows ?? [])
    .filter(m => m.profile != null)
    .map(m => m.profile!)

  type MsgRow = { id: string; author_id: string; body: string; created_at: string }
  const { data: msgRows } = await admin
    .from('messages')
    .select('id, author_id, body, created_at')
    .eq('team_id', team.id)
    .order('created_at', { ascending: false })
    .limit(50) as { data: MsgRow[] | null; error: unknown }

  const messages = (msgRows ?? []).slice().reverse()

  const statusLabel: Record<string, string> = {
    active: 'Activo',
    on_hold: 'En pausa',
    archived: 'Archivado',
  }

  const statusColor: Record<string, string> = {
    active: 'bg-green-100 text-green-700',
    on_hold: 'bg-yellow-100 text-yellow-700',
    archived: 'bg-gray-100 text-gray-600',
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1.5">
            <Link href={`/w/${params.workspaceSlug}`} className="hover:text-foreground transition-colors">
              {workspace.name}
            </Link>
            <span>/</span>
            <span className="text-foreground/70">Equipo</span>
          </p>
          <h1 className="text-2xl font-semibold text-foreground">{team.name}</h1>
          {team.description && (
            <p className="text-sm text-muted-foreground mt-1">{team.description}</p>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/w/${params.workspaceSlug}/t/${params.teamSlug}/scrum`}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            <LayoutDashboard className="w-4 h-4" />
            Ir a Planeación
          </Link>
          <Link
            href={`/w/${params.workspaceSlug}/t/${params.teamSlug}/projects/new`}
            className="flex items-center gap-1.5 px-3 py-2 border border-border text-foreground text-sm font-medium rounded-lg hover:bg-muted transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Nuevo proyecto
          </Link>
        </div>
      </div>

      {/* Cuerpo: proyectos (izquierda) + chat general del equipo (derecha) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Proyectos */}
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Proyectos
          </h2>
          {!projects || projects.length === 0 ? (
            <div className="border-2 border-dashed border-border rounded-xl p-12 text-center">
              <FolderKanban className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground mb-1">Sin proyectos aún</h3>
              <p className="text-sm text-muted-foreground mb-4">
                Crea el primer proyecto para este equipo.
              </p>
              <Link
                href={`/w/${params.workspaceSlug}/t/${params.teamSlug}/projects/new`}
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
              >
                Crear proyecto
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {projects.map(project => (
                <Link
                  key={project.id}
                  href={`/w/${params.workspaceSlug}/t/${params.teamSlug}/p/${project.slug}`}
                  className="block bg-card border border-border rounded-xl p-4 hover:border-ring/50 hover:shadow-sm transition-all group"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <ProjectIcon icon={project.icon} size={20} className="text-muted-foreground flex-shrink-0" />
                      <h3 className="text-sm font-medium text-foreground group-hover:text-primary transition-colors line-clamp-2">
                        {project.name}
                      </h3>
                    </div>
                    <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded-full font-medium ${statusColor[project.status] ?? 'bg-muted text-muted-foreground'}`}>
                      {statusLabel[project.status] ?? project.status}
                    </span>
                  </div>
                  {project.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                      {project.description}
                    </p>
                  )}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-3">
                    <ListChecks className="w-3.5 h-3.5" />
                    <span>{taskCount.get(project.id) ?? 0} tareas</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Chat general del equipo (embebido en el panel) */}
        <aside className="lg:col-span-1">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" />
              Chat general
            </h2>
            <Link
              href={`/w/${params.workspaceSlug}/t/${params.teamSlug}/chat`}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title="Abrir chat en pantalla completa"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="flex flex-col bg-card border border-border rounded-xl overflow-hidden h-[520px]">
            <TeamChat
              teamId={team.id}
              currentUserId={user.id}
              members={members}
              initialMessages={messages}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}

/**
 * Proyectos (Marketplace interno): tablero con tres vistas.
 *
 *   - Abiertos: proyectos APROBADOS y abiertos a postulaciones (te postulas).
 *   - Mis proyectos: donde ya participas (con progreso y accion de completar).
 *   - Pendientes: solo administradores, proyectos propuestos por aprobar.
 *
 * Nueva logica de producto: todos pueden proponer proyectos, pero solo los
 * administradores de la organizacion los autorizan. Al llegar al 100%, el lider
 * (o un admin) marca el proyecto como completado y se habilita la evaluacion de
 * pares.
 *
 * Server component: resuelve el workspace desde la membresia (anti-RLS-loop),
 * arma los tres conjuntos y delega el render al tablero cliente.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { Compass } from 'lucide-react'
import { computeProjectProgress } from '@/lib/project-progress'
import { ProjectsBoard, type MarketProject, type MyProject, type PendingProject } from './ProjectsBoard'

interface PageProps {
  params: { workspaceSlug: string }
}

export default async function ProjectsMarketplacePage({ params }: PageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // Workspace desde membership (anti-RLS-loop)
  type WsFromMember = { workspaces: { id: string; name: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null }
  const workspace = row?.workspaces
  if (!workspace) redirect('/')

  // Rol de organizacion (para ver/aprobar pendientes)
  const { data: profile } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', user.id)
    .maybeSingle() as { data: { org_role: string } | null }
  const isAdmin = profile?.org_role === 'owner' || profile?.org_role === 'admin'

  const nowIso = new Date().toISOString()

  // ─── Abiertos: aprobados + abiertos a postulaciones ───────────────────────────
  type ProjRow = {
    id: string; name: string; slug: string; icon: string | null; description: string | null
    scope: string | null; deliverables: string | null; lead_id: string | null
    application_deadline: string | null; max_members: number | null
    lead: { id: string; display_name: string | null; avatar_url: string | null } | null
  }
  const { data: openProjects } = await admin
    .from('projects')
    .select('id, name, slug, icon, description, scope, deliverables, lead_id, application_deadline, max_members, lead:profiles!projects_lead_id_fkey(id, display_name, avatar_url)')
    .eq('workspace_id', workspace.id)
    .eq('open_for_applications', true)
    .eq('approval_status', 'approved')
    .eq('is_archived', false)
    .or(`application_deadline.is.null,application_deadline.gte.${nowIso}`)
    .order('application_deadline', { ascending: true, nullsFirst: false }) as { data: ProjRow[] | null }

  const openList = openProjects ?? []
  const openIds = openList.map(p => p.id)

  // Estado del solicitante + conteo de miembros (para el grid de Abiertos)
  let memberOf = new Set<string>()
  const appStatus = new Map<string, string>()
  const memberCount = new Map<string, number>()
  if (openIds.length > 0) {
    const [{ data: myMemberships }, { data: myApps }, { data: allMembers }] = await Promise.all([
      admin.from('project_members').select('project_id').eq('profile_id', user.id).in('project_id', openIds) as Promise<{ data: { project_id: string }[] | null }>,
      admin.from('project_applications').select('project_id, status').eq('applicant_id', user.id).in('project_id', openIds) as Promise<{ data: { project_id: string; status: string }[] | null }>,
      admin.from('project_members').select('project_id').in('project_id', openIds) as Promise<{ data: { project_id: string }[] | null }>,
    ])
    memberOf = new Set((myMemberships ?? []).map(m => m.project_id))
    for (const a of myApps ?? []) appStatus.set(a.project_id, a.status)
    for (const m of allMembers ?? []) memberCount.set(m.project_id, (memberCount.get(m.project_id) ?? 0) + 1)
  }

  const marketProjects: MarketProject[] = openList.map(p => ({
    id: p.id,
    name: p.name,
    icon: p.icon,
    description: p.description,
    scope: p.scope,
    deliverables: p.deliverables,
    application_deadline: p.application_deadline,
    max_members: p.max_members,
    member_count: memberCount.get(p.id) ?? 0,
    lead: p.lead,
    is_lead: p.lead_id === user.id,
    is_member: memberOf.has(p.id),
    my_application_status: appStatus.get(p.id) ?? null,
  }))

  // ─── Mis proyectos: donde participo (cualquier estado, no archivados) ──────────
  type MyMemberRow = {
    role: string
    project: {
      id: string; name: string; icon: string | null; description: string | null
      status: string; approval_status: string; lead_id: string | null
    } | null
  }
  const { data: myRows } = await admin
    .from('project_members')
    .select('role, project:projects!project_members_project_id_fkey(id, name, icon, description, status, approval_status, lead_id)')
    .eq('profile_id', user.id) as { data: MyMemberRow[] | null }

  const myValid = (myRows ?? [])
    .filter(r => r.project && r.project.approval_status !== 'rejected')
  const myProjects: MyProject[] = await Promise.all(
    myValid.map(async r => {
      const pr = r.project!
      const progress = await computeProjectProgress(admin, pr.id)
      const isLead = pr.lead_id === user.id
      const isManager = r.role === 'manager'
      return {
        id: pr.id,
        name: pr.name,
        icon: pr.icon,
        description: pr.description,
        status: pr.status,
        approval_status: pr.approval_status,
        my_role: isLead ? 'lider' : r.role,
        pct: progress.pct,
        total: progress.total,
        done: progress.done,
        is_lead: isLead,
        can_complete: (isLead || isManager || isAdmin) && pr.status !== 'completed' && progress.pct === 100 && progress.total > 0,
      }
    })
  )
  myProjects.sort((a, b) => a.name.localeCompare(b.name))

  // ─── Pendientes de aprobacion: solo administradores ───────────────────────────
  let pendingProjects: PendingProject[] = []
  if (isAdmin) {
    type PendRow = {
      id: string; name: string; icon: string | null; description: string | null; created_at: string
      lead: { display_name: string | null; avatar_url: string | null } | null
    }
    const { data: pend } = await admin
      .from('projects')
      .select('id, name, icon, description, created_at, lead:profiles!projects_lead_id_fkey(display_name, avatar_url)')
      .eq('workspace_id', workspace.id)
      .eq('approval_status', 'pending')
      .eq('is_archived', false)
      .order('created_at', { ascending: false }) as { data: PendRow[] | null }
    pendingProjects = (pend ?? []).map(p => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      description: p.description,
      created_at: p.created_at,
      proposer_name: p.lead?.display_name ?? null,
      proposer_avatar: p.lead?.avatar_url ?? null,
    }))
  }

  return (
    <>
      {/* Aclara: esto es el marketplace de oportunidades, NO el trabajo diario del equipo */}
      <div className="max-w-5xl mx-auto px-6 pt-6">
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
          <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Compass className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Oportunidades internas: postúlate a proyectos abiertos</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Aquí encuentras y te postulas a proyectos de la organización. Para tu trabajo diario, entra al equipo y su Tablero.
            </p>
          </div>
        </div>
      </div>

      <ProjectsBoard
        workspaceName={workspace.name}
        workspaceSlug={params.workspaceSlug}
        userId={user.id}
        isAdmin={isAdmin}
        openProjects={marketProjects}
        myProjects={myProjects}
        pendingProjects={pendingProjects}
      />
    </>
  )
}

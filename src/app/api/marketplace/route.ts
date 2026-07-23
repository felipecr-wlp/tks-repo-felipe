/**
 * GET /api/marketplace: proyectos ABIERTOS a postulaciones.
 *
 * Corazon de la nueva logica: en vez de ser asignado, cada quien EXPLORA los
 * proyectos abiertos de sus workspaces y se postula. Devuelve, por proyecto, si
 * el solicitante ya es miembro o ya se postulo (para pintar el estado del boton).
 *
 * Filtro por query opcional:
 *   ?workspace_id=<uuid>  limita a un workspace concreto.
 *
 * Admin client + verificacion de sesion en el handler (evita IDOR): solo se
 * exponen proyectos de los workspaces a los que el solicitante pertenece.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const wsFilter = request.nextUrl.searchParams.get('workspace_id')

  // Workspaces del solicitante (limita la exposicion a lo que le corresponde)
  const { data: wsRows } = await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('profile_id', user.id) as { data: { workspace_id: string }[] | null }
  let workspaceIds = (wsRows ?? []).map(w => w.workspace_id)
  if (wsFilter) workspaceIds = workspaceIds.filter(id => id === wsFilter)
  if (workspaceIds.length === 0) return NextResponse.json({ projects: [] })

  // Proyectos abiertos, no archivados, con deadline vigente (o sin deadline)
  const nowIso = new Date().toISOString()
  type ProjRow = {
    id: string; name: string; slug: string; icon: string | null; description: string | null
    scope: string | null; deliverables: string | null; workspace_id: string
    application_deadline: string | null; max_members: number | null
    lead:   { id: string; display_name: string | null; avatar_url: string | null } | null
  }
  const { data: projects } = await admin
    .from('projects')
    .select('id, name, slug, icon, description, scope, deliverables, workspace_id, application_deadline, max_members, lead:profiles!projects_lead_id_fkey(id, display_name, avatar_url)')
    .in('workspace_id', workspaceIds)
    .eq('open_for_applications', true)
    .eq('is_archived', false)
    .or(`application_deadline.is.null,application_deadline.gte.${nowIso}`)
    .order('application_deadline', { ascending: true, nullsFirst: false })
    .limit(200) as { data: ProjRow[] | null }

  const list = projects ?? []
  if (list.length === 0) return NextResponse.json({ projects: [] })

  const projectIds = list.map(p => p.id)

  // Estado del solicitante frente a cada proyecto + conteo de miembros
  const [{ data: myMemberships }, { data: myApps }, { data: allMembers }] = await Promise.all([
    admin.from('project_members').select('project_id').eq('profile_id', user.id).in('project_id', projectIds),
    admin.from('project_applications').select('project_id, status').eq('applicant_id', user.id).in('project_id', projectIds),
    admin.from('project_members').select('project_id').in('project_id', projectIds),
  ])

  const memberOf = new Set((myMemberships ?? []).map(m => m.project_id))
  const appStatusByProject = new Map((myApps ?? []).map(a => [a.project_id, a.status]))
  const memberCount = new Map<string, number>()
  for (const m of allMembers ?? []) memberCount.set(m.project_id, (memberCount.get(m.project_id) ?? 0) + 1)

  const result = list.map(p => ({
    id:                   p.id,
    name:                 p.name,
    slug:                 p.slug,
    icon:                 p.icon,
    description:          p.description,
    scope:               p.scope,
    deliverables:        p.deliverables,
    workspace_id:         p.workspace_id,
    application_deadline: p.application_deadline,
    max_members:          p.max_members,
    member_count:         memberCount.get(p.id) ?? 0,
    lead:                 p.lead,
    is_member:            memberOf.has(p.id),
    my_application_status: appStatusByProject.get(p.id) ?? null,
  }))

  return NextResponse.json({ projects: result })
}

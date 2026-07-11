/**
 * GET /api/search?q=texto&workspace_id=xxx
 *
 * Búsqueda global en un workspace. Devuelve tasks, projects, teams, members.
 * Usa ILIKE simple, para escala añadir tsvector + GIN en futuro.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const querySchema = z.object({
  q:            z.string().min(1).max(80).trim(),
  workspace_id: z.string().uuid(),
})

const PER_TYPE_LIMIT = 5

interface SearchResult {
  tasks: Array<{
    id: string
    title: string
    project_slug: string | null
    project_name: string | null
    team_slug: string | null
  }>
  projects: Array<{
    id: string
    name: string
    slug: string
    icon: string | null
    team_slug: string | null
  }>
  teams: Array<{
    id: string
    name: string
    slug: string
  }>
  members: Array<{
    id: string
    display_name: string
    avatar_url: string | null
    email: string | null
  }>
}

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const url = new URL(request.url)
  const parsed = querySchema.safeParse({
    q: url.searchParams.get('q'),
    workspace_id: url.searchParams.get('workspace_id'),
  })
  if (!parsed.success) {
    return NextResponse.json(
      { tasks: [], projects: [], teams: [], members: [] } satisfies SearchResult
    )
  }

  const { q, workspace_id } = parsed.data
  const admin = createAdminClient()

  // Verificar acceso al workspace
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) {
    return NextResponse.json({ error: 'Sin acceso al workspace' }, { status: 403 })
  }

  const escaped = `%${q.replace(/[%_]/g, '\\$&')}%`

  // ── Tasks (con relaciones para navegación) ────────────────────────────────
  type TaskRow = {
    id: string
    title: string
    project: { slug: string; name: string; team: { slug: string } | null } | null
  }
  const { data: tasksRaw } = await admin
    .from('tasks')
    .select(`
      id, title,
      project:projects ( slug, name, team:teams ( slug ) )
    `)
    .eq('workspace_id', workspace_id)
    .eq('is_archived', false)
    .ilike('title', escaped)
    .limit(PER_TYPE_LIMIT) as { data: TaskRow[] | null; error: unknown }

  // ── Projects ─────────────────────────────────────────────────────────────
  type ProjectRow = {
    id: string
    name: string
    slug: string
    icon: string | null
    team: { slug: string } | null
  }
  const { data: projectsRaw } = await admin
    .from('projects')
    .select(`
      id, name, slug, icon,
      team:teams ( slug )
    `)
    .eq('workspace_id', workspace_id)
    .eq('is_archived', false)
    .ilike('name', escaped)
    .limit(PER_TYPE_LIMIT) as { data: ProjectRow[] | null; error: unknown }

  // ── Teams ────────────────────────────────────────────────────────────────
  type TeamRow = { id: string; name: string; slug: string }
  const { data: teamsRaw } = await admin
    .from('teams')
    .select('id, name, slug')
    .eq('workspace_id', workspace_id)
    .ilike('name', escaped)
    .limit(PER_TYPE_LIMIT) as { data: TeamRow[] | null; error: unknown }

  // ── Members del workspace ─────────────────────────────────────────────────
  type WsMemberRow = {
    profile: {
      id: string
      display_name: string
      avatar_url: string | null
      email: string | null
    } | null
  }
  const { data: membersRaw } = await admin
    .from('workspace_members')
    .select('profile:profiles!inner ( id, display_name, avatar_url, email )')
    .eq('workspace_id', workspace_id)
    .ilike('profile.display_name', escaped)
    .limit(PER_TYPE_LIMIT) as { data: WsMemberRow[] | null; error: unknown }

  const result: SearchResult = {
    tasks: (tasksRaw ?? []).map(t => ({
      id: t.id,
      title: t.title,
      project_slug: t.project?.slug ?? null,
      project_name: t.project?.name ?? null,
      team_slug: t.project?.team?.slug ?? null,
    })),
    projects: (projectsRaw ?? []).map(p => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      icon: p.icon,
      team_slug: p.team?.slug ?? null,
    })),
    teams: (teamsRaw ?? []).map(t => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
    })),
    members: (membersRaw ?? [])
      .filter(m => m.profile != null)
      .map(m => ({
        id: m.profile!.id,
        display_name: m.profile!.display_name,
        avatar_url: m.profile!.avatar_url,
        email: m.profile!.email,
      })),
  }

  return NextResponse.json(result)
}

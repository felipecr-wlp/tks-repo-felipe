/**
 * GET /api/search?q=texto&workspace_id=xxx[&full=1][&limit=N]
 *
 * Búsqueda global en un workspace. Devuelve tasks, projects, teams, members y notes.
 *
 * Matching: además del título/nombre se busca en el cuerpo (task.description,
 * note.content, project.description). Con ILIKE simple. Los índices GIN trigram
 * existentes cubren tasks.title y notes.title; para el body a esta escala el
 * ILIKE sin índice es aceptable. Ruta de escala futura: columna tsvector
 * materializada + índice GIN (to_tsvector) y `websearch_to_tsquery`, o pg_trgm
 * GIN sobre las columnas de cuerpo.
 *
 * Las consultas por tipo son INDEPENDIENTES: corren en paralelo con Promise.all.
 *
 * Las notes respetan la visibilidad app-layer (reflejo del RLS): notas privadas
 * solo las ve su autor y las de departamentos restringidos solo sus miembros o
 * los admins de la org. Nunca se filtra contenido restringido en la búsqueda.
 *
 * `full=1` (o `limit=N`) sube el tope por tipo para la página de resultados;
 * sin él se usa el tope pequeño del preview del command palette.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const querySchema = z.object({
  q:            z.string().min(1).max(80).trim(),
  workspace_id: z.string().uuid(),
  full:         z.coerce.boolean().optional(),
  limit:        z.coerce.number().int().min(1).max(50).optional(),
})

const PREVIEW_LIMIT = 5
const FULL_LIMIT = 25

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
  notes: Array<{
    id: string
    title: string
    icon: string | null
    doc_kind: string | null
  }>
}

const EMPTY_RESULT: SearchResult = { tasks: [], projects: [], teams: [], members: [], notes: [] }

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
    full: url.searchParams.get('full') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(EMPTY_RESULT satisfies SearchResult)
  }

  const { q, workspace_id, full, limit } = parsed.data
  const perType = Math.min(limit ?? (full ? FULL_LIMIT : PREVIEW_LIMIT), FULL_LIMIT)
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
  // Filtro OR de PostgREST: matchea en el título/nombre O en el cuerpo.
  const taskMatch    = `title.ilike.${escaped},description.ilike.${escaped}`
  const projectMatch = `name.ilike.${escaped},description.ilike.${escaped}`
  const noteMatch    = `title.ilike.${escaped},content.ilike.${escaped}`

  // Notas: se trae un margen extra (tope alto) porque el filtro de visibilidad
  // de espacios restringidos se aplica en memoria; luego se recorta a perType.
  const noteFetch = Math.max(perType * 4, 30)

  type TaskRow = {
    id: string
    title: string
    project: { slug: string; name: string; team: { slug: string } | null } | null
  }
  type ProjectRow = {
    id: string
    name: string
    slug: string
    icon: string | null
    team: { slug: string } | null
  }
  type TeamRow = { id: string; name: string; slug: string }
  type WsMemberRow = {
    profile: {
      id: string
      display_name: string
      avatar_url: string | null
      email: string | null
    } | null
  }
  type NoteRow = {
    id: string
    title: string
    icon: string | null
    doc_kind: string | null
    visibility: string | null
    created_by: string | null
    space_id: string | null
  }

  // ── Consultas independientes en PARALELO ──────────────────────────────────
  const [
    { data: tasksRaw },
    { data: projectsRaw },
    { data: teamsRaw },
    { data: membersRaw },
    { data: notesRaw },
  ] = await Promise.all([
    // Tasks (título o descripción)
    admin
      .from('tasks')
      .select(`
        id, title,
        project:projects ( slug, name, team:teams ( slug ) )
      `)
      .eq('workspace_id', workspace_id)
      .eq('is_archived', false)
      .or(taskMatch)
      // as unknown as: el join embebido difiere de la forma TaskRow escrita a mano
      .limit(perType) as unknown as Promise<{ data: TaskRow[] | null; error: unknown }>,

    // Projects (nombre o descripción)
    admin
      .from('projects')
      .select(`
        id, name, slug, icon,
        team:teams ( slug )
      `)
      .eq('workspace_id', workspace_id)
      .eq('is_archived', false)
      .or(projectMatch)
      // as unknown as: el join embebido difiere de la forma ProjectRow escrita a mano
      .limit(perType) as unknown as Promise<{ data: ProjectRow[] | null; error: unknown }>,

    // Teams (solo nombre)
    admin
      .from('teams')
      .select('id, name, slug')
      .eq('workspace_id', workspace_id)
      .ilike('name', escaped)
      .limit(perType) as unknown as Promise<{ data: TeamRow[] | null; error: unknown }>,

    // Members del workspace (por display_name)
    admin
      .from('workspace_members')
      .select('profile:profiles!inner ( id, display_name, avatar_url, email )')
      .eq('workspace_id', workspace_id)
      .ilike('profile.display_name', escaped)
      // as unknown as: el join embebido difiere de la forma WsMemberRow escrita a mano
      .limit(perType) as unknown as Promise<{ data: WsMemberRow[] | null; error: unknown }>,

    // Notes (título o contenido). Privadas ajenas fuera en la consulta;
    // el gating de espacios restringidos queda en JS (depende de membresias).
    admin
      .from('notes')
      .select('id, title, icon, doc_kind, visibility, created_by, space_id')
      .eq('workspace_id', workspace_id)
      .or(noteMatch)
      .or(`visibility.neq.private,visibility.is.null,created_by.eq.${user.id}`)
      .order('updated_at', { ascending: false })
      .limit(noteFetch) as unknown as Promise<{ data: NoteRow[] | null; error: unknown }>,
  ])

  // ── Gating de espacios restringidos (reflejo del RLS, igual que /api/notes) ─
  // Departamentos restringidos que el user NO puede ver.
  let blockedSpaceIds = new Set<string>()
  if ((notesRaw ?? []).some(n => n.space_id)) {
    const { data: myProfile } = await admin
      .from('profiles')
      .select('org_role')
      .eq('id', user.id)
      .maybeSingle() as { data: { org_role: string | null } | null; error: unknown }
    const isOrgAdmin = myProfile?.org_role === 'owner' || myProfile?.org_role === 'admin'

    if (!isOrgAdmin) {
      const [{ data: rawSpaces }, { data: myMemberships }] = await Promise.all([
        admin
          .from('spaces')
          .select('id, is_restricted')
          .eq('workspace_id', workspace_id)
          .eq('is_restricted', true)
          .limit(500) as unknown as Promise<{ data: { id: string; is_restricted: boolean }[] | null; error: unknown }>,
        admin
          .from('space_members')
          .select('space_id')
          .eq('profile_id', user.id) as unknown as Promise<{ data: { space_id: string }[] | null; error: unknown }>,
      ])
      const mySpaceIds = new Set((myMemberships ?? []).map(m => m.space_id))
      blockedSpaceIds = new Set(
        (rawSpaces ?? [])
          .filter(s => s.is_restricted && !mySpaceIds.has(s.id))
          .map(s => s.id)
      )
    }
  }

  // Las privadas ajenas ya se filtraron en la consulta; aqui solo queda el
  // gating de espacios restringidos (necesita las membresias de arriba).
  const visibleNotes = (notesRaw ?? [])
    .filter(n => {
      if (n.space_id && blockedSpaceIds.has(n.space_id)) return false
      return true
    })
    .slice(0, perType)

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
    notes: visibleNotes.map(n => ({
      id: n.id,
      title: n.title,
      icon: n.icon,
      doc_kind: n.doc_kind,
    })),
  }

  return NextResponse.json(result)
}

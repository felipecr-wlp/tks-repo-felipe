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
import { accessibleSpaceIds } from '@/lib/note-space-access'
import { loadNoteViewerContext, canViewNote, noteVisibilityPrefilter } from '@/lib/note-visibility'

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

  // TODOS los tipos que cuelgan de un departamento (notas, y ademas tareas,
  // proyectos y equipos) se traen con margen extra: el filtro de espacios
  // restringidos se aplica en memoria y luego se recorta a perType. Sin el
  // margen, una sola fila bloqueada dejaria hueco en los resultados.
  const overFetch = Math.max(perType * 4, 30)
  const noteFetch = overFetch

  type TaskRow = {
    id: string
    title: string
    project: { slug: string; name: string; team: { slug: string; space_id: string | null } | null } | null
  }
  type ProjectRow = {
    id: string
    name: string
    slug: string
    icon: string | null
    team: { slug: string; space_id: string | null } | null
  }
  type TeamRow = { id: string; name: string; slug: string; space_id: string | null }
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
    project_id: string | null
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
        project:projects ( slug, name, team:teams ( slug, space_id ) )
      `)
      .eq('workspace_id', workspace_id)
      .eq('is_archived', false)
      .or(taskMatch)
      // as unknown as: el join embebido difiere de la forma TaskRow escrita a mano
      .limit(overFetch) as unknown as Promise<{ data: TaskRow[] | null; error: unknown }>,

    // Projects (nombre o descripción)
    admin
      .from('projects')
      .select(`
        id, name, slug, icon,
        team:teams ( slug, space_id )
      `)
      .eq('workspace_id', workspace_id)
      .eq('is_archived', false)
      .or(projectMatch)
      // as unknown as: el join embebido difiere de la forma ProjectRow escrita a mano
      .limit(overFetch) as unknown as Promise<{ data: ProjectRow[] | null; error: unknown }>,

    // Teams (solo nombre)
    admin
      .from('teams')
      .select('id, name, slug, space_id')
      .eq('workspace_id', workspace_id)
      .ilike('name', escaped)
      .limit(overFetch) as unknown as Promise<{ data: TeamRow[] | null; error: unknown }>,

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
      .select('id, title, icon, doc_kind, visibility, created_by, space_id, project_id')
      .eq('workspace_id', workspace_id)
      .or(noteMatch)
      .or(noteVisibilityPrefilter(user.id))
      .order('updated_at', { ascending: false })
      .limit(noteFetch) as unknown as Promise<{ data: NoteRow[] | null; error: unknown }>,
  ])

  // ── Gating de espacios restringidos (reflejo del RLS) ─────────────────────
  // Aplica a TODO lo que cuelga de un departamento, no solo a las notas:
  //   - notas          -> notes.space_id            (policy notes_restrict_space)
  //   - equipos        -> teams.space_id            (policy teams_select / can_see_team)
  //   - proyectos      -> project.team.space_id     (heredan el depto de su equipo)
  //   - tareas         -> task.project.team.space_id
  // Esta ruta lee con el admin client (bypassa RLS), asi que el candado vive
  // aqui. Historico: hasta 2026-07-28 solo se filtraban las notas, y por eso
  // cualquier miembro podia leer titulos de tareas y proyectos de Finanzas,
  // Legal, RH o Seguridad buscando una palabra suelta.
  const gatedSpaceIds = [
    ...(notesRaw ?? []).map(n => n.space_id),
    ...(teamsRaw ?? []).map(t => t.space_id),
    ...(projectsRaw ?? []).map(p => p.team?.space_id ?? null),
    ...(tasksRaw ?? []).map(t => t.project?.team?.space_id ?? null),
  ]
  const allowedSpaceIds = await accessibleSpaceIds(admin, gatedSpaceIds, user.id)

  /** space_id null = suelto a nivel workspace, visible para todo miembro. */
  const spaceVisible = (spaceId: string | null | undefined) =>
    !spaceId || allowedSpaceIds.has(spaceId)

  // Las notas ademas pasan por su modelo propio de visibilidad: privada = solo
  // el autor, compartida = su departamento, no toda la empresa. Sin esto el
  // buscador seria la puerta de atras a las notas de cualquiera.
  const noteCtx = await loadNoteViewerContext(admin, workspace_id, user.id)
  const visibleNotes   = (notesRaw ?? []).filter(n => canViewNote(noteCtx, n)).slice(0, perType)
  const visibleTeams   = (teamsRaw ?? []).filter(t => spaceVisible(t.space_id)).slice(0, perType)
  const visibleProjects = (projectsRaw ?? []).filter(p => spaceVisible(p.team?.space_id)).slice(0, perType)
  const visibleTasks   = (tasksRaw ?? []).filter(t => spaceVisible(t.project?.team?.space_id)).slice(0, perType)

  const result: SearchResult = {
    tasks: visibleTasks.map(t => ({
      id: t.id,
      title: t.title,
      project_slug: t.project?.slug ?? null,
      project_name: t.project?.name ?? null,
      team_slug: t.project?.team?.slug ?? null,
    })),
    projects: visibleProjects.map(p => ({
      id: p.id,
      name: p.name,
      slug: p.slug,
      icon: p.icon,
      team_slug: p.team?.slug ?? null,
    })),
    teams: visibleTeams.map(t => ({
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

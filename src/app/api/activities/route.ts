/**
 * GET /api/activities?from=&to=, Actividades WLO del usuario en un rango.
 *
 * Fuente unica para MiDia y CalendarView de "lo que pasa en WLO" (no Google):
 *  - Tareas ASIGNADAS al usuario (assignee_id = user.id, no archivadas) con
 *    due_date dentro del rango.
 *  - Fin de SPRINTS de los equipos del usuario (end_date dentro del rango).
 *
 * Seguridad:
 *  - Auth obligatorio (401), rate limit, admin client para leer con joins.
 *  - Anti-IDOR: SOLO se devuelven datos de equipos donde el user es miembro
 *    (re-check via team_members). Aunque una tarea diga assignee = user, se
 *    valida ademas que su proyecto pertenezca a un equipo del usuario.
 *  - from/to validados con zod .strict() (datetime opcional). Default: hoy -1d a +60d.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const querySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
}).strict()

export type WloActivity =
  | {
      id: string
      type: 'task'
      title: string
      date: string
      priority: string | null
      project_name: string | null
      href: string
    }
  | {
      id: string
      type: 'sprint'
      title: string
      date: string
      priority: null
      project_name: null
      href: string
    }

type TeamMeta = { slug: string; wsSlug: string }
type ProjectMeta = { name: string; slug: string; teamId: string | null }

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const { searchParams } = new URL(request.url)

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const parsed = querySchema.safeParse({
    from: searchParams.get('from') ?? undefined,
    to: searchParams.get('to') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ error: 'Parametros invalidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const now = new Date()
  const from = parsed.data.from ?? new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
  const to = parsed.data.to ?? new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000).toISOString()
  // Los sprints usan columna date (sin hora); comparamos por fecha calendario.
  const fromDate = from.slice(0, 10)
  const toDate = to.slice(0, 10)

  const admin = createAdminClient()

  // Equipos del usuario (re-check de membresia; base del anti-IDOR).
  const { data: memberRows, error: memberErr } = await admin
    .from('team_members')
    .select('team_id')
    .eq('profile_id', user.id) as { data: { team_id: string }[] | null; error: unknown }
  if (memberErr) {
    console.error('[activities GET] team_members read error:', memberErr)
    return NextResponse.json({ error: 'Error al cargar actividades' }, { status: 500 })
  }

  const memberTeamIds = Array.from(new Set((memberRows ?? []).map(r => r.team_id).filter(Boolean)))
  if (memberTeamIds.length === 0) {
    return NextResponse.json({ activities: [] })
  }

  // Metadatos de equipos (slug + slug de su workspace) para armar los href.
  type TeamRow = { id: string; slug: string; workspace: { slug: string } | { slug: string }[] | null }
  const { data: teamRows, error: teamErr } = await admin
    .from('teams')
    .select('id, slug, workspace:workspaces ( slug )')
    .in('id', memberTeamIds) as { data: TeamRow[] | null; error: unknown }
  if (teamErr) {
    console.error('[activities GET] teams read error:', teamErr)
    return NextResponse.json({ error: 'Error al cargar actividades' }, { status: 500 })
  }

  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  const teamMeta = new Map<string, TeamMeta>()
  for (const t of teamRows ?? []) {
    const ws = one(t.workspace)
    teamMeta.set(t.id, { slug: t.slug, wsSlug: ws?.slug ?? '' })
  }

  // Proyectos de esos equipos (para filtrar tareas y resolver nombre/slug).
  type ProjRow = { id: string; name: string; slug: string; team_id: string | null }
  const { data: projRows, error: projErr } = await admin
    .from('projects')
    .select('id, name, slug, team_id')
    .in('team_id', memberTeamIds)
    .limit(1000) as { data: ProjRow[] | null; error: unknown }
  if (projErr) {
    console.error('[activities GET] projects read error:', projErr)
    return NextResponse.json({ error: 'Error al cargar actividades' }, { status: 500 })
  }

  const projectMeta = new Map<string, ProjectMeta>()
  for (const p of projRows ?? []) {
    projectMeta.set(p.id, { name: p.name, slug: p.slug, teamId: p.team_id })
  }
  const memberProjectIds = Array.from(projectMeta.keys())

  const activities: WloActivity[] = []

  // Tareas asignadas al usuario con due_date en el rango (solo de sus proyectos).
  if (memberProjectIds.length > 0) {
    type TaskRow = {
      id: string; title: string; priority: string | null; due_date: string | null; project_id: string | null
    }
    const { data: taskRows, error: taskErr } = await admin
      .from('tasks')
      .select('id, title, priority, due_date, project_id')
      .eq('assignee_id', user.id)
      .eq('is_archived', false)
      .not('due_date', 'is', null)
      .gte('due_date', from)
      .lte('due_date', to)
      .in('project_id', memberProjectIds)
      .order('due_date', { ascending: true })
      .limit(500) as { data: TaskRow[] | null; error: unknown }
    if (taskErr) {
      console.error('[activities GET] tasks read error:', taskErr)
      return NextResponse.json({ error: 'Error al cargar actividades' }, { status: 500 })
    }

    for (const t of taskRows ?? []) {
      if (!t.due_date || !t.project_id) continue
      const pm = projectMeta.get(t.project_id)
      const tm = pm?.teamId ? teamMeta.get(pm.teamId) : null
      const href = pm && tm && tm.wsSlug
        ? `/w/${tm.wsSlug}/t/${tm.slug}/p/${pm.slug}`
        : ''
      activities.push({
        id: t.id,
        type: 'task',
        title: t.title,
        date: t.due_date,
        priority: t.priority,
        project_name: pm?.name ?? null,
        href,
      })
    }
  }

  // Fin de sprints de sus equipos dentro del rango.
  type SprintRow = { id: string; name: string; end_date: string | null; team_id: string | null }
  const { data: sprintRows, error: sprintErr } = await admin
    .from('sprints')
    .select('id, name, end_date, team_id')
    .in('team_id', memberTeamIds)
    .not('end_date', 'is', null)
    .gte('end_date', fromDate)
    .lte('end_date', toDate)
    .order('end_date', { ascending: true }) as { data: SprintRow[] | null; error: unknown }
  if (sprintErr) {
    console.error('[activities GET] sprints read error:', sprintErr)
    return NextResponse.json({ error: 'Error al cargar actividades' }, { status: 500 })
  }

  for (const s of sprintRows ?? []) {
    if (!s.end_date) continue
    const tm = s.team_id ? teamMeta.get(s.team_id) : null
    const href = tm && tm.wsSlug ? `/w/${tm.wsSlug}/t/${tm.slug}` : ''
    activities.push({
      id: s.id,
      type: 'sprint',
      title: s.name,
      date: s.end_date,
      priority: null,
      project_name: null,
      href,
    })
  }

  // Orden cronologico ascendente por fecha.
  activities.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())

  return NextResponse.json({ activities })
}

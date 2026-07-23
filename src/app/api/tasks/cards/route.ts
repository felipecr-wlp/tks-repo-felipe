/**
 * GET /api/tasks/cards?team_id=<uuid>&ids=<uuid,uuid,...>
 *
 * Resuelve tarjetas vivas de tarea para pintar los adjuntos del chat (Circuito
 * 1.A). Devuelve titulo, prioridad, estado, asignado y el href para abrir la
 * tarea en su tablero. Solo tareas cuyos proyectos pertenecen al equipo, para
 * que un id inyectado en el body no filtre datos de otro equipo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { canAccessTeamById } from '@/lib/team-access'
import { applyRateLimit } from '@/lib/rate-limit'

interface TaskCardRow {
  id: string
  title: string
  priority: string
  status: { name: string; color: string | null } | null
  assignee: { display_name: string; avatar_url: string | null } | null
  projects: {
    slug: string
    team_id: string
    teams: { slug: string } | null
    workspaces: { slug: string } | null
  } | null
}

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const url = new URL(request.url)
  const team_id = url.searchParams.get('team_id')
  const idsRaw = (url.searchParams.get('ids') ?? '').trim()

  if (!team_id || !z.string().uuid().safeParse(team_id).success) {
    return NextResponse.json({ error: 'team_id inválido' }, { status: 422 })
  }

  const ids = Array.from(
    new Set(
      idsRaw
        .split(',')
        .map(s => s.trim())
        .filter(s => z.string().uuid().safeParse(s).success)
    )
  ).slice(0, 30)

  if (ids.length === 0) return NextResponse.json({ cards: [] })

  const admin = createAdminClient()
  if (!(await canAccessTeamById(admin, team_id, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })
  }

  const { data: rows, error: rowsError } = (await admin
    .from('tasks')
    .select(`
      id, title, priority,
      status:task_statuses ( name, color ),
      assignee:profiles!tasks_assignee_id_fkey ( display_name, avatar_url ),
      projects!inner ( slug, team_id, teams ( slug ), workspaces ( slug ) )
    `)
    .in('id', ids)
    .eq('projects.team_id', team_id)) as { data: TaskCardRow[] | null; error: unknown }

  if (rowsError) {
    console.error('[tasks/cards GET] tasks read error:', rowsError)
    return NextResponse.json({ error: 'Error al cargar tarjetas' }, { status: 500 })
  }

  const cards = (rows ?? []).map(r => {
    const wsSlug = r.projects?.workspaces?.slug ?? ''
    const teamSlug = r.projects?.teams?.slug ?? ''
    const projSlug = r.projects?.slug ?? ''
    const href =
      wsSlug && teamSlug && projSlug
        ? `/w/${wsSlug}/t/${teamSlug}/p/${projSlug}?task=${r.id}`
        : ''
    return {
      id: r.id,
      title: r.title,
      priority: r.priority,
      status: r.status ? { name: r.status.name, color: r.status.color } : null,
      assignee: r.assignee
        ? { display_name: r.assignee.display_name, avatar_url: r.assignee.avatar_url }
        : null,
      href,
    }
  })

  return NextResponse.json({ cards })
}

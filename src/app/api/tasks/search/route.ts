/**
 * GET /api/tasks/search?team_id=<uuid>&q=<texto>&limit=8
 *
 * Buscador de tareas de un equipo para adjuntarlas al chat (Circuito 1.A).
 * Solo devuelve tareas cuyos proyectos pertenecen al equipo (anti fuga entre
 * equipos). Acceso: miembro del equipo o admin del workspace.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { canAccessTeamById } from '@/lib/team-access'
import { applyRateLimit } from '@/lib/rate-limit'

interface TaskSearchRow {
  id: string
  title: string
  priority: string
  status: { name: string; color: string | null } | null
  projects: { name: string } | null
}

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const url = new URL(request.url)
  const team_id = url.searchParams.get('team_id')
  const q = (url.searchParams.get('q') ?? '').trim()
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '8', 10)
  const limit = Math.min(Math.max(Number.isNaN(limitRaw) ? 8 : limitRaw, 1), 20)

  if (!team_id || !z.string().uuid().safeParse(team_id).success) {
    return NextResponse.json({ error: 'team_id inválido' }, { status: 422 })
  }

  const admin = createAdminClient()
  if (!(await canAccessTeamById(admin, team_id, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from('tasks')
    .select('id, title, priority, status:task_statuses ( name, color ), projects!inner ( name, team_id )')
    .eq('projects.team_id', team_id)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })
    .limit(limit)

  if (q) query = query.ilike('title', `%${q}%`)

  const { data: rows } = (await query) as { data: TaskSearchRow[] | null; error: unknown }

  const tasks = (rows ?? []).map(r => ({
    id: r.id,
    title: r.title,
    priority: r.priority,
    status: r.status ? { name: r.status.name, color: r.status.color } : null,
    project_name: r.projects?.name ?? '',
  }))

  return NextResponse.json({ tasks })
}

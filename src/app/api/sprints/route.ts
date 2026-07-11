/**
 * GET  /api/sprints?team_id=..., Lista los sprints de un equipo
 * POST /api/sprints, Crea un sprint para un equipo
 *
 * Sprints viven a nivel de equipo (team-scoped). Autorización manual con
 * admin client (bypass RLS) + membership de team_members, mismo molde que
 * el resto de la API de tareas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const teamId = request.nextUrl.searchParams.get('team_id')
  if (!teamId) return NextResponse.json({ error: 'team_id requerido' }, { status: 400 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })

  const { data: sprints } = await admin
    .from('sprints')
    .select('id, name, goal, status, start_date, end_date, created_at')
    .eq('team_id', teamId)
    .order('start_date', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  return NextResponse.json(sprints ?? [])
}

// ── POST ──────────────────────────────────────────────────────────────────────
const createSchema = z.object({
  team_id:    z.string().uuid(),
  name:       z.string().min(1).max(120).trim(),
  goal:       z.string().max(500).nullable().optional(),
  status:     z.enum(['planning', 'active', 'completed']).optional().default('planning'),
  start_date: z.string().optional().nullable(),
  end_date:   z.string().optional().nullable(),
})

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { team_id, name, goal, status, start_date, end_date } = parsed.data

  const admin = createAdminClient()

  // Acceso al equipo
  const { data: membership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', team_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })

  // workspace_id del equipo (denormalización para RLS y scoping)
  type TeamRow = { workspace_id: string }
  const { data: team } = await admin
    .from('teams')
    .select('workspace_id')
    .eq('id', team_id)
    .maybeSingle() as { data: TeamRow | null; error: unknown }

  if (!team) return NextResponse.json({ error: 'Equipo no encontrado' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sprint, error } = await (admin as any)
    .from('sprints')
    .insert({
      team_id,
      workspace_id: team.workspace_id,
      name,
      goal: goal ?? null,
      status,
      start_date: start_date || null,
      end_date: end_date || null,
      created_by: user.id,
    })
    .select('id, name, goal, status, start_date, end_date, created_at')
    .single()

  if (error || !sprint) {
    console.error('[sprints POST] insert error:', error)
    return NextResponse.json({ error: 'Error al crear el sprint' }, { status: 500 })
  }

  return NextResponse.json(sprint, { status: 201 })
}

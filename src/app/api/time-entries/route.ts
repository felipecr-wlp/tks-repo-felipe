/**
 * GET  /api/time-entries?from=&to=&project_id=  -> entradas propias (timesheet).
 * POST /api/time-entries                         -> alta MANUAL de una entrada
 *                                                   { task_id, started_at, ended_at, note? }.
 *
 * Seguridad: auth + un usuario solo lee/edita SUS entradas. El alta manual
 * re-chequea que la tarea pertenezca a un proyecto del que el usuario es miembro
 * (anti-IDOR en resolveTaskAccess). zod strict + rate limit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { resolveTaskAccess } from './_access'

// ── GET: timesheet propio ─────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { searchParams } = new URL(request.url)
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const projectId = searchParams.get('project_id')

  let query = admin
    .from('time_entries')
    .select(`
      id, task_id, project_id, workspace_id, profile_id, started_at, ended_at, duration_sec, note, created_at,
      task:tasks ( id, title ),
      project:projects ( id, name )
    `)
    .eq('profile_id', user.id)
    .order('started_at', { ascending: false })
    .limit(500)

  if (from) query = query.gte('started_at', from)
  if (to) query = query.lte('started_at', to)
  if (projectId) query = query.eq('project_id', projectId)

  const { data, error } = await query
  if (error) {
    console.error('[time-entries GET] error:', error)
    return NextResponse.json({ error: 'Error al cargar las entradas' }, { status: 500 })
  }
  return NextResponse.json(data ?? [])
}

// ── POST: alta manual ─────────────────────────────────────────────────────────
const manualSchema = z.object({
  task_id:    z.string().uuid(),
  started_at: z.string().datetime(),
  ended_at:   z.string().datetime(),
  note:       z.string().max(1000).trim().optional(),
}).strict()

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }

  const parsed = manualSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { task_id, started_at, ended_at, note } = parsed.data
  const startMs = new Date(started_at).getTime()
  const endMs = new Date(ended_at).getTime()
  if (endMs <= startMs) {
    return NextResponse.json({ error: 'La hora de fin debe ser posterior al inicio' }, { status: 422 })
  }
  const durationSec = Math.round((endMs - startMs) / 1000)

  const access = await resolveTaskAccess(task_id, user.id)
  if (!access) return NextResponse.json({ error: 'Tarea sin acceso' }, { status: 403 })

  const admin = createAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: entry, error } = await (admin as any)
    .from('time_entries')
    .insert({
      task_id,
      project_id:   access.project_id,
      workspace_id: access.workspace_id,
      profile_id:   user.id,
      started_at,
      ended_at,
      duration_sec: durationSec,
      note: note ?? null,
    })
    .select('id, task_id, project_id, workspace_id, started_at, ended_at, duration_sec, note, created_at')
    .single()

  if (error || !entry) {
    console.error('[time-entries POST manual] error:', error)
    return NextResponse.json({ error: 'Error al guardar la entrada' }, { status: 500 })
  }
  return NextResponse.json(entry, { status: 201 })
}

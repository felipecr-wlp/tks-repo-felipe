/**
 * POST /api/time-entries/start  { task_id }  -> crea una entrada corriendo.
 *
 * Solo puede haber UN timer activo por persona: lo garantiza el indice unico
 * parcial te_one_running (profile_id) WHERE ended_at IS NULL. Si ya hay uno,
 * el insert viola la unicidad (23505) y respondemos 409.
 *
 * Seguridad: auth + resolveTaskAccess (anti-IDOR) + zod strict + rate limit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { resolveTaskAccess } from '../_access'

const schema = z.object({
  task_id: z.string().uuid(),
  note:    z.string().max(1000).trim().optional(),
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

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { task_id, note } = parsed.data
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
      started_at:   new Date().toISOString(),
      note: note ?? null,
    })
    .select('id, task_id, project_id, workspace_id, started_at, ended_at, duration_sec, note, created_at')
    .single()

  if (error) {
    // 23505 = violacion de unicidad => ya hay un timer corriendo.
    if ((error as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Ya tienes un timer activo. Detenlo antes de iniciar otro.' }, { status: 409 })
    }
    console.error('[time-entries start] error:', error)
    return NextResponse.json({ error: 'Error al iniciar el timer' }, { status: 500 })
  }

  return NextResponse.json(entry, { status: 201 })
}

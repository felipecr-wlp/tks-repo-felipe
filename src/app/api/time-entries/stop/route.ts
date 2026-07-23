/**
 * POST /api/time-entries/stop  { note? }  -> detiene el timer activo del usuario.
 *
 * Busca la entrada corriendo (profile_id propio, ended_at IS NULL), fija ended_at
 * y calcula duration_sec. Devuelve 404 si no hay timer activo.
 *
 * Seguridad: auth + solo se toca la entrada propia + zod strict + rate limit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const schema = z.object({
  note: z.string().max(1000).trim().optional(),
}).strict()

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  // El body es opcional; si viene, se valida.
  let note: string | undefined
  const text = await request.text()
  if (text) {
    let raw: unknown
    try { raw = JSON.parse(text) }
    catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }
    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos invalidos', details: parsed.error.flatten() }, { status: 422 })
    }
    note = parsed.data.note
  }

  const admin = createAdminClient()

  const { data: running } = await admin
    .from('time_entries')
    .select('id, started_at, note')
    .eq('profile_id', user.id)
    .is('ended_at', null)
    .maybeSingle() as { data: { id: string; started_at: string; note: string | null } | null }

  if (!running) return NextResponse.json({ error: 'No hay un timer activo' }, { status: 404 })

  const endedAt = new Date()
  const durationSec = Math.max(0, Math.round((endedAt.getTime() - new Date(running.started_at).getTime()) / 1000))

  const { data: entry, error } = await admin
    .from('time_entries')
    .update({
      ended_at:     endedAt.toISOString(),
      duration_sec: durationSec,
      note: note ?? running.note,
    })
    .eq('id', running.id)
    .eq('profile_id', user.id)
    .select('id, task_id, project_id, workspace_id, started_at, ended_at, duration_sec, note, created_at')
    .single()

  if (error || !entry) {
    console.error('[time-entries stop] error:', error)
    return NextResponse.json({ error: 'Error al detener el timer' }, { status: 500 })
  }

  return NextResponse.json(entry)
}

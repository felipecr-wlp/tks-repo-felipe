/**
 * GET /api/tasks/[taskId]/time, resumen de tiempo registrado en la tarea.
 *
 * Devuelve el total de segundos acumulados por TODO el equipo en la tarea, la
 * lista de entradas (con su autor) y el timer propio en curso si existe. La
 * escritura de tiempo (iniciar, detener, alta manual, borrar) sigue viviendo en
 * /api/time-entries/*; aqui solo se agrega para el panel de la tarea.
 *
 * Anti-IDOR: el taskId viene de la ruta y se valida por membresia del proyecto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { checkTaskAccess } from '@/lib/task-access'

interface RouteParams {
  params: { taskId: string }
}

type Author = { id: string; display_name: string; avatar_url: string | null }
type EntryRow = {
  id: string
  profile_id: string
  started_at: string
  ended_at: string | null
  duration_sec: number | null
  note: string | null
  profile: Author | null
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error },
      { status: access.status },
    )
  }

  const { data } = await admin
    .from('time_entries')
    .select('id, profile_id, started_at, ended_at, duration_sec, note, profile:profiles ( id, display_name, avatar_url )')
    .eq('task_id', params.taskId)
    .order('started_at', { ascending: false })
    .limit(200) as { data: EntryRow[] | null }

  const rows = data ?? []
  const totalSec = rows.reduce((acc, r) => acc + (r.duration_sec ?? 0), 0)
  const running = rows.find(r => r.ended_at === null && r.profile_id === user.id) ?? null

  return NextResponse.json({
    totalSec,
    runningEntryId: running?.id ?? null,
    entries: rows.map(r => ({
      id: r.id,
      profile: r.profile,
      started_at: r.started_at,
      ended_at: r.ended_at,
      duration_sec: r.duration_sec,
      note: r.note,
    })),
  })
}

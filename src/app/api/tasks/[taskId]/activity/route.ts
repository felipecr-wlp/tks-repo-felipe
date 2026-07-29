/**
 * GET /api/tasks/[taskId]/activity, historial de actividad de una tarea.
 *
 * Devuelve los eventos de activity_events del objeto (object_type='task') mas
 * recientes primero, con el actor (subject) resuelto. Circuito B12: da al panel
 * de detalle un feed de "quien hizo que y cuando", el complemento visible de las
 * notificaciones de seguidores (B10/B11): el seguidor recibe el aviso y aqui ve
 * exactamente que cambio.
 *
 * Anti-IDOR: el taskId viene de la ruta y se valida por membresia de proyecto
 * (checkTaskAccess) usando el admin client, igual que el resto de subrecursos.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { checkTaskAccess } from '@/lib/task-access'

interface RouteParams {
  params: { taskId: string }
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
      { error: access.status === 404 ? 'Tarea no encontrada' : 'Sin acceso' },
      { status: access.status },
    )
  }

  type EventRow = {
    id: string
    verb: string
    created_at: string
    metadata: Record<string, unknown> | null
    subject: { id: string; display_name: string; avatar_url: string | null } | null
  }
  const { data: events, error: eventsError } = await admin
    .from('activity_events')
    .select('id, verb, created_at, metadata, subject:profiles ( id, display_name, avatar_url )')
    .eq('object_type', 'task')
    .eq('object_id', params.taskId)
    .eq('is_superseded', false)
    .order('created_at', { ascending: false })
    .limit(50) as { data: EventRow[] | null; error: unknown }

  if (eventsError) {
    console.error('[task activity GET] read error:', eventsError)
    return NextResponse.json({ error: 'Error al cargar actividad' }, { status: 500 })
  }

  return NextResponse.json({ events: events ?? [] })
}

/**
 * PATCH /api/academy/access/[requestId]  { action: 'approve' | 'reject', workspaceId? }
 *   Solo admin/owner de la org. Aprueba o rechaza una solicitud de acceso.
 *   Al aprobar: marca la solicitud 'approved' y concede el acceso
 *   (upsert en academy_access). Al rechazar: marca 'rejected'.
 *   Notifica al solicitante (best-effort).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { createNotification } from '@/lib/activity'
import { isOrgAdmin } from '@/lib/academy/data'
import { COURSE_BY_ID } from '@/lib/academy/courses'

interface RouteParams {
  params: { requestId: string }
}

const schema = z.object({
  action: z.enum(['approve', 'reject']),
  workspaceId: z.string().uuid().optional().nullable(),
})

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.requestId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  if (!(await isOrgAdmin(user.id))) {
    return NextResponse.json({ error: 'Sin permiso' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()

  const { data: req } = (await admin
    .from('academy_access_requests')
    .select('id, profile_id, course_id, status')
    .eq('id', params.requestId)
    .maybeSingle()) as {
    data: { id: string; profile_id: string; course_id: string; status: string } | null
  }
  if (!req) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
  if (req.status !== 'pending') {
    return NextResponse.json({ error: 'La solicitud ya fue resuelta' }, { status: 409 })
  }

  const newStatus = parsed.data.action === 'approve' ? 'approved' : 'rejected'

  // ORDEN: primero se CONCEDE y despues se marca resuelta. No son dos escrituras
  // intercambiables. Al reves (marcar y luego conceder), si la concesion falla la
  // solicitud queda 'approved' sin acceso, desaparece de la lista de pendientes y
  // ya no se puede reintentar: este mismo handler responde 409 a todo lo que no
  // este 'pending'. La persona se queda esperando para siempre y nadie se entera.
  //
  // En este orden el peor caso es benigno: tiene el acceso y la solicitud sigue
  // pendiente, o sea VISIBLE y reintentable. El upsert es idempotente, asi que
  // volver a aprobarla no rompe nada.
  if (parsed.data.action === 'approve') {
    const { error: accErr } = await admin
      .from('academy_access')
      .upsert(
        { profile_id: req.profile_id, course_id: req.course_id, granted_by: user.id },
        { onConflict: 'profile_id,course_id' },
      )
    if (accErr) {
      console.error('[academy access PATCH] grant error:', accErr)
      return NextResponse.json({ error: 'No se pudo conceder el acceso' }, { status: 500 })
    }
  }

  const { error: updErr } = await admin
    .from('academy_access_requests')
    .update({ status: newStatus, decided_by: user.id, decided_at: new Date().toISOString() })
    .eq('id', req.id)
  if (updErr) {
    console.error('[academy access PATCH] update error:', updErr)
    return NextResponse.json({ error: 'No se pudo actualizar' }, { status: 500 })
  }

  // Notificar al solicitante (best-effort).
  const wsId = parsed.data.workspaceId
  if (wsId) {
    try {
      const course = COURSE_BY_ID[req.course_id]
      await createNotification({
        recipient_id: req.profile_id,
        subject_id: user.id,
        type: parsed.data.action === 'approve' ? 'academy_access_granted' : 'academy_access_rejected',
        object_type: 'academy_course',
        object_title: course?.title ?? req.course_id,
        workspace_id: wsId,
      })
    } catch {
      /* best-effort */
    }
  }

  return NextResponse.json({ ok: true, status: newStatus })
}

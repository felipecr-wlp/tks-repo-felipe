/**
 * POST   /api/tickets/[ticketId]/watchers   involucra a alguien mas.
 * DELETE /api/tickets/[ticketId]/watchers   lo saca (o te sales tu).
 *
 * Esto es "poder involucrar a mas personas" hecho una operacion y no un reenvio
 * de chat. Un involucrado VE la solicitud completa, comenta y recibe avisos.
 * Lo que NO gana es decidir: canalizar sigue siendo del admin y hacer sigue
 * siendo del responsable.
 *
 * ── Quien puede sumar gente ─────────────────────────────────────────────────
 * Quien la pidio, quien esta a cargo y los mandos. Un involucrado NO puede
 * involucrar a otro: si pudiera, una solicitud con datos sensibles (una queja,
 * un problema de nomina) se difundiria por la cadena sin que quien la escribio
 * se entere. Salirse uno mismo si se puede siempre.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { notify } from '@/lib/activity'
import { cargarSolicitud, puedeVer } from '@/lib/tickets/acceso'

const schema = z.object({ profileId: z.string().uuid() }).strict()

/** Puede sumar o quitar a terceros. */
function puedeInvolucrar(s: { esSolicitante: boolean; esResponsable: boolean; esAdmin: boolean }) {
  return s.esSolicitante || s.esResponsable || s.esAdmin
}

export async function POST(
  request: NextRequest,
  { params }: { params: { ticketId: string } },
) {
  if (!isUuid(params.ticketId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let crudo: unknown
  try { crudo = await request.json() }
  catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const parsed = schema.safeParse(crudo)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()
  const s = await cargarSolicitud(admin, params.ticketId, user.id)
  if (!s) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })
  if (!puedeVer(s)) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  if (!puedeInvolucrar(s)) {
    return NextResponse.json(
      { error: 'Solo quien la pidió, quien está a cargo o un administrador puede involucrar a alguien más.' },
      { status: 403 },
    )
  }

  // Tiene que ser del workspace. Involucrar a alguien de fuera le daria acceso a
  // una solicitud de una organizacion que no es la suya.
  const { data: miembro } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', s.workspace_id)
    .eq('profile_id', parsed.data.profileId)
    .maybeSingle()
  if (!miembro) {
    return NextResponse.json({ error: 'Esa persona no pertenece a este workspace' }, { status: 422 })
  }

  // upsert y no insert: sumar dos veces a la misma persona no es un error que
  // valga la pena contarle a nadie, es un doble clic.
  const { error } = await admin
    .from('ticket_watchers')
    .upsert(
      { ticket_id: s.id, profile_id: parsed.data.profileId, added_by: user.id },
      { onConflict: 'ticket_id,profile_id' },
    )
  if (error) {
    console.error('[ticket watchers] insert error:', error)
    return NextResponse.json({ error: 'No se pudo involucrar a esa persona' }, { status: 500 })
  }

  if (parsed.data.profileId !== user.id) {
    await notify({
      workspace_id: s.workspace_id,
      recipient_id: parsed.data.profileId,
      subject_id: user.id,
      type: 'ticket_involved',
      object_type: 'ticket',
      object_id: s.id,
      object_title: 'Te involucró en una solicitud',
    })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { ticketId: string } },
) {
  if (!isUuid(params.ticketId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let crudo: unknown
  try { crudo = await request.json() }
  catch { return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 }) }

  const parsed = schema.safeParse(crudo)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()
  const s = await cargarSolicitud(admin, params.ticketId, user.id)
  if (!s) return NextResponse.json({ error: 'Solicitud no encontrada' }, { status: 404 })

  // Salirse uno mismo no necesita permiso de nadie. Quitar a un tercero si.
  const propio = parsed.data.profileId === user.id
  if (!propio && !puedeInvolucrar(s)) {
    return NextResponse.json({ error: 'Sin permiso para quitar a esa persona' }, { status: 403 })
  }
  if (propio && !puedeVer(s)) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const { error } = await admin
    .from('ticket_watchers')
    .delete()
    .eq('ticket_id', s.id)
    .eq('profile_id', parsed.data.profileId)
  if (error) {
    console.error('[ticket watchers] delete error:', error)
    return NextResponse.json({ error: 'No se pudo quitar' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

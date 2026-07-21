/**
 * POST /api/teams/[teamId]/reminders
 * Crea un recordatorio programado desde el chat de EQUIPO (Circuito 1.C).
 * Body: { remind_at (ISO), body?, target_id?, message_id? }
 *
 * Semantica:
 *  - target_id opcional: por defecto el recordatorio es para uno mismo. Si se
 *    manda, debe ser un miembro del equipo (anti-IDOR: no se puede recordar a
 *    alguien ajeno al equipo).
 *  - message_id opcional: si el recordatorio nace de un mensaje, debe pertenecer
 *    a ESTE equipo (defensa anti-IDOR). Se guarda por referencia.
 *  - remind_at debe estar en el futuro (con un pequeno margen) y dentro de 1 ano.
 *
 * El recordatorio queda 'pending'; el cron `due-reminders` lo entrega al inbox
 * (y opcionalmente por correo) cuando `remind_at` ya paso, y lo marca 'sent'.
 *
 * Authz en capas:
 *  1. El usuario debe tener acceso al equipo (canAccessTeamById).
 *  2. target_id (si viene) debe ser miembro del equipo.
 *  3. message_id (si viene) debe pertenecer al equipo.
 *  4. creator_id se toma del usuario autenticado, nunca del body.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canAccessTeamById } from '@/lib/team-access'

const schema = z.object({
  remind_at:  z.string().datetime({ offset: true }),
  body:       z.string().max(500).trim().optional(),
  target_id:  z.string().uuid().optional(),
  message_id: z.string().uuid().optional(),
}).strict()

export async function POST(
  request: NextRequest,
  { params }: { params: { teamId: string } }
) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { remind_at, body, target_id, message_id } = parsed.data

  // La fecha debe estar en el futuro (margen 30s) y dentro de 1 ano.
  const when = new Date(remind_at)
  const now = Date.now()
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: 'Fecha inválida' }, { status: 422 })
  }
  if (when.getTime() < now + 30_000) {
    return NextResponse.json({ error: 'La fecha debe estar en el futuro' }, { status: 422 })
  }
  if (when.getTime() > now + 365 * 24 * 60 * 60 * 1000) {
    return NextResponse.json({ error: 'La fecha no puede ser a más de un año' }, { status: 422 })
  }

  const admin = createAdminClient()

  if (!(await canAccessTeamById(admin, params.teamId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })
  }

  // Destinatario: por defecto uno mismo; si se especifica otro, debe ser miembro.
  const targetId = target_id ?? user.id
  if (targetId !== user.id) {
    const { data: member } = await admin
      .from('team_members')
      .select('profile_id')
      .eq('team_id', params.teamId)
      .eq('profile_id', targetId)
      .maybeSingle() as { data: { profile_id: string } | null }
    if (!member) {
      return NextResponse.json({ error: 'El destinatario no es miembro del equipo' }, { status: 422 })
    }
  }

  // Mensaje de origen (opcional): debe pertenecer a este equipo.
  if (message_id) {
    const { data: msg } = await admin
      .from('messages')
      .select('id')
      .eq('id', message_id)
      .eq('team_id', params.teamId)
      .maybeSingle() as { data: { id: string } | null }
    if (!msg) {
      return NextResponse.json({ error: 'Mensaje no encontrado' }, { status: 404 })
    }
  }

  // workspace_id del equipo (para scoping de la notificacion futura).
  const { data: team } = await admin
    .from('teams')
    .select('workspace_id')
    .eq('id', params.teamId)
    .maybeSingle() as { data: { workspace_id: string } | null }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: reminder, error } = await (admin as any)
    .from('reminders')
    .insert({
      workspace_id: team?.workspace_id ?? null,
      team_id:      params.teamId,
      creator_id:   user.id,
      target_id:    targetId,
      message_id:   message_id ?? null,
      body:         body ?? '',
      remind_at:    when.toISOString(),
      status:       'pending',
    })
    .select('id, remind_at, target_id, body, status')
    .single()

  if (error || !reminder) {
    console.error('[reminders POST] insert error:', error)
    return NextResponse.json({ error: 'Error al crear el recordatorio' }, { status: 500 })
  }

  return NextResponse.json(reminder, { status: 201 })
}

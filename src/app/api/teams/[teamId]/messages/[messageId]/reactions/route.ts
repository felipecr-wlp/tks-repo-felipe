/**
 * POST /api/teams/[teamId]/messages/[messageId]/reactions
 * Alterna (toggle) una reaccion con emoji sobre un mensaje del chat de EQUIPO.
 * Body: { emoji }
 *
 * Espeja el route del chat de proyecto pero sobre team_message_reactions (tabla
 * dedicada, ver migracion 20260720510000). Si la persona ya reacciono con ese
 * emoji, se retira; si no, se agrega. Devuelve el estado resultante para que el
 * cliente lo refleje al instante; el realtime propaga el cambio a los demas.
 *
 * Anti-IDOR en capas:
 *  1. El usuario debe tener acceso al equipo (canAccessTeamById).
 *  2. El mensaje debe pertenecer a ESTE equipo (teamId viene de la ruta).
 *  3. profile_id se toma del usuario autenticado, nunca del body.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canAccessTeamById } from '@/lib/team-access'

// Lista blanca de emojis: mantiene el set consistente con el picker de la UI y
// evita que se guarden cadenas arbitrarias como "emoji".
const ALLOWED = ['👍', '❤️', '😄', '🎉', '🙌', '👀', '🔥', '✅'] as const

const schema = z.object({
  emoji: z.enum(ALLOWED),
}).strict()

export async function POST(
  request: NextRequest,
  { params }: { params: { teamId: string; messageId: string } }
) {
  if (!isUuid(params.teamId) || !isUuid(params.messageId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
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

  const admin = createAdminClient()
  if (!(await canAccessTeamById(admin, params.teamId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })
  }

  // El mensaje debe pertenecer a este equipo (defensa anti-IDOR).
  const { data: msg } = await admin
    .from('messages')
    .select('id')
    .eq('id', params.messageId)
    .eq('team_id', params.teamId)
    .maybeSingle() as { data: { id: string } | null }
  if (!msg) return NextResponse.json({ error: 'Mensaje no encontrado' }, { status: 404 })

  const emoji = parsed.data.emoji

  // Toggle: si ya existe la reaccion de esta persona con este emoji, se retira.
  const { data: existing } = await admin
    .from('team_message_reactions')
    .select('id')
    .eq('message_id', params.messageId)
    .eq('profile_id', user.id)
    .eq('emoji', emoji)
    .maybeSingle() as { data: { id: string } | null }

  const db = admin

  if (existing) {
    const { error } = await db.from('team_message_reactions').delete().eq('id', existing.id)
    if (error) {
      console.error('[team reactions POST] delete error:', error)
      return NextResponse.json({ error: 'Error al quitar la reacción' }, { status: 500 })
    }
    return NextResponse.json({ active: false, emoji, messageId: params.messageId })
  }

  const { error } = await db.from('team_message_reactions').insert({
    message_id: params.messageId,
    team_id: params.teamId,
    profile_id: user.id,
    emoji,
  })
  if (error) {
    console.error('[team reactions POST] insert error:', error)
    return NextResponse.json({ error: 'Error al reaccionar' }, { status: 500 })
  }
  return NextResponse.json({ active: true, emoji, messageId: params.messageId }, { status: 201 })
}

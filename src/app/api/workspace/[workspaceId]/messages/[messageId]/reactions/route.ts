/**
 * POST /api/workspace/[workspaceId]/messages/[messageId]/reactions
 * Alterna (toggle) una reaccion con emoji sobre un mensaje del chat GENERAL del
 * workspace. Body: { emoji }
 *
 * Espeja el route del chat de equipo pero sobre workspace_message_reactions
 * (tabla dedicada, ver migracion 20260727000000). Si la persona ya reacciono con
 * ese emoji, se retira; si no, se agrega. Devuelve el estado resultante para que
 * el cliente lo refleje al instante; el realtime propaga el cambio a los demas.
 *
 * Anti-IDOR en capas:
 *  1. El usuario debe tener acceso al workspace (canAccessWorkspaceById).
 *  2. El mensaje debe pertenecer a ESTE workspace (workspaceId viene de la ruta).
 *  3. profile_id se toma del usuario autenticado, nunca del body.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canAccessWorkspaceById } from '@/lib/team-access'

// Lista blanca de emojis: debe coincidir con el picker de la UI.
const ALLOWED = ['👍', '❤️', '😄', '🎉', '🙌', '👀', '🔥', '✅'] as const

const schema = z.object({
  emoji: z.enum(ALLOWED),
}).strict()

export async function POST(
  request: NextRequest,
  { params }: { params: { workspaceId: string; messageId: string } }
) {
  if (!isUuid(params.workspaceId) || !isUuid(params.messageId)) {
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
  if (!(await canAccessWorkspaceById(admin, params.workspaceId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al workspace' }, { status: 403 })
  }

  // El mensaje debe pertenecer a este workspace (defensa anti-IDOR).
  const { data: msg } = await admin
    .from('workspace_messages')
    .select('id')
    .eq('id', params.messageId)
    .eq('workspace_id', params.workspaceId)
    .maybeSingle() as { data: { id: string } | null }
  if (!msg) return NextResponse.json({ error: 'Mensaje no encontrado' }, { status: 404 })

  const emoji = parsed.data.emoji

  // Toggle: si ya existe la reaccion de esta persona con este emoji, se retira.
  const { data: existing } = await admin
    .from('workspace_message_reactions')
    .select('id')
    .eq('message_id', params.messageId)
    .eq('profile_id', user.id)
    .eq('emoji', emoji)
    .maybeSingle() as { data: { id: string } | null }

  if (existing) {
    const { error } = await admin.from('workspace_message_reactions').delete().eq('id', existing.id)
    if (error) {
      console.error('[ws reactions POST] delete error:', error)
      return NextResponse.json({ error: 'Error al quitar la reacción' }, { status: 500 })
    }
    return NextResponse.json({ active: false, emoji, messageId: params.messageId })
  }

  const { error } = await admin.from('workspace_message_reactions').insert({
    message_id: params.messageId,
    workspace_id: params.workspaceId,
    profile_id: user.id,
    emoji,
  })
  if (error) {
    console.error('[ws reactions POST] insert error:', error)
    return NextResponse.json({ error: 'Error al reaccionar' }, { status: 500 })
  }
  return NextResponse.json({ active: true, emoji, messageId: params.messageId }, { status: 201 })
}

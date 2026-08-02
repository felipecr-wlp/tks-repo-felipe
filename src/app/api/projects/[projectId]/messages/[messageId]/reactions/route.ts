/**
 * POST /api/projects/[projectId]/messages/[messageId]/reactions
 * Alterna (toggle) una reaccion con emoji sobre un mensaje del chat del proyecto.
 * Body: { emoji }
 *
 * Si la persona ya reacciono con ese emoji, se retira; si no, se agrega. Devuelve
 * el estado resultante para que el cliente lo refleje al instante; el realtime
 * sobre message_reactions propaga el cambio a los demas.
 *
 * Anti-IDOR en capas:
 *  1. El usuario debe ser miembro del proyecto o de su workspace.
 *  2. El mensaje debe pertenecer a ESTE proyecto (projectId viene de la ruta).
 *  3. profile_id se toma del usuario autenticado, nunca del body.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { ERROR_ACCESO_INDETERMINADO } from '@/lib/team-access'

// Lista blanca de emojis permitidos: mantiene el set consistente con el picker de
// la UI y evita que se guarden cadenas arbitrarias como "emoji".
const ALLOWED = ['👍', '❤️', '😄', '🎉', '🙌', '👀', '🔥', '✅'] as const

const schema = z.object({
  emoji: z.enum(ALLOWED),
}).strict()

/**
 * ¿Pertenece el user al proyecto o a su workspace? NO es la regla de
 * `canAccessProject` (@/lib/team-access), que exige owner/admin del workspace:
 * esta acepta a cualquier miembro del workspace, igual que el chat del que
 * cuelgan estas reacciones. La diferencia es deliberada; el nombre compartido
 * con la barrera auditada no lo era.
 *
 * `failed` separa "no pertenece" de "no pude averiguarlo": antes las tres
 * lecturas descartaban su `error` y una base caida terminaba en 403.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function isProjectOrWorkspaceMember(admin: any, projectId: string, userId: string): Promise<{ ok: boolean; failed: boolean }> {
  const { data: project, error: projectErr } = await admin
    .from('projects')
    .select('id, workspace_id')
    .eq('id', projectId)
    .maybeSingle() as { data: { id: string; workspace_id: string } | null; error: unknown }
  if (projectErr) console.error('[message reactions] projects read error:', projectErr)
  if (!project) return { ok: false, failed: !!projectErr }

  const { data: pmem, error: pmemErr } = await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', projectId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { profile_id: string } | null; error: unknown }
  if (pmemErr) console.error('[message reactions] project_members read error:', pmemErr)
  if (pmem) return { ok: true, failed: false }

  const { data: wmem, error: wmemErr } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', project.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { profile_id: string } | null; error: unknown }
  if (wmemErr) console.error('[message reactions] workspace_members read error:', wmemErr)
  const ok = !!wmem
  return { ok, failed: !ok && !!(pmemErr || wmemErr) }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string; messageId: string } }
) {
  if (!isUuid(params.projectId) || !isUuid(params.messageId)) {
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
  const acceso = await isProjectOrWorkspaceMember(admin, params.projectId, user.id)
  if (acceso.failed) {
    return NextResponse.json({ error: ERROR_ACCESO_INDETERMINADO }, { status: 500 })
  }
  if (!acceso.ok) {
    return NextResponse.json({ error: 'Sin acceso al proyecto' }, { status: 403 })
  }

  // El mensaje debe pertenecer a este proyecto (defensa anti-IDOR).
  const { data: msg } = await admin
    .from('project_messages')
    .select('id')
    .eq('id', params.messageId)
    .eq('project_id', params.projectId)
    .maybeSingle() as { data: { id: string } | null }
  if (!msg) return NextResponse.json({ error: 'Mensaje no encontrado' }, { status: 404 })

  const emoji = parsed.data.emoji

  // Toggle: si ya existe la reaccion de esta persona con este emoji, se retira.
  const { data: existing } = await admin
    .from('message_reactions')
    .select('id')
    .eq('message_id', params.messageId)
    .eq('profile_id', user.id)
    .eq('emoji', emoji)
    .maybeSingle() as { data: { id: string } | null }

  const db = admin

  if (existing) {
    const { error } = await db.from('message_reactions').delete().eq('id', existing.id)
    if (error) {
      console.error('[reactions POST] delete error:', error)
      return NextResponse.json({ error: 'Error al quitar la reacción' }, { status: 500 })
    }
    return NextResponse.json({ active: false, emoji, messageId: params.messageId })
  }

  const { error } = await db.from('message_reactions').insert({
    message_id: params.messageId,
    project_id: params.projectId,
    profile_id: user.id,
    emoji,
  })
  if (error) {
    console.error('[reactions POST] insert error:', error)
    return NextResponse.json({ error: 'Error al reaccionar' }, { status: 500 })
  }
  return NextResponse.json({ active: true, emoji, messageId: params.messageId }, { status: 201 })
}

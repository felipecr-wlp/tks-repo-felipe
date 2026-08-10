/**
 * /api/academy/certifications
 *
 * POST  { itemType, itemId }            -> ACUSE de la persona (para SI misma).
 * PATCH { profileId, itemType, itemId } -> FIRMA del supervisor (solo admin).
 *
 * DOS EJES DISTINTOS EN UN ARCHIVO, y por eso el gate no es el mismo:
 *   - El acuse lo da la persona sobre SU fila (profile_id: user.id). Nadie
 *     puede acusar por otro: seria falsificar una declaracion con el nombre de
 *     alguien mas, que es justo lo que un acuse existe para evitar.
 *   - La firma la da un admin sobre la fila de OTRO. Es un acto de autoridad y
 *     se registra CON NOMBRE (verified_by) y fecha.
 *
 * El vencimiento lo calcula el SERVIDOR a partir de valid_months del contenido,
 * nunca lo manda el cliente: una fecha de vigencia elegida por quien se
 * certifica no vale nada.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isOrgAdmin } from '@/lib/team-access'
import { calcularVencimiento } from '@/lib/academy/certificacion'

const acuseSchema = z.object({
  itemType: z.enum(['course', 'video']),
  itemId: z.string().min(1).max(64),
})

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const parsed = acuseSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()

  // El TEXTO que se acepta se guarda en la fila, no solo la marca de tiempo.
  // Si mañana cambia el compromiso, lo que la persona firmó sigue siendo lo
  // que leyó ese día: un acuse que apunta a un texto editable no prueba nada.
  let texto = 'Confirmo que vi el contenido, lo entendí y me comprometo a aplicarlo.'
  if (parsed.data.itemType === 'video') {
    const { data: v } = await admin
      .from('academy_videos')
      .select('ack_text')
      .eq('id', parsed.data.itemId)
      .maybeSingle()
    if (v?.ack_text?.trim()) texto = v.ack_text.trim()
  }

  const ahora = new Date().toISOString()
  const { error } = await admin
    .from('academy_certifications')
    .upsert({
      profile_id: user.id,
      item_type: parsed.data.itemType,
      item_id: parsed.data.itemId,
      acknowledged_at: ahora,
      acknowledged_text: texto,
      updated_at: ahora,
    }, { onConflict: 'profile_id,item_type,item_id' })

  if (error) {
    console.error('[academy certifications POST] error:', error)
    return NextResponse.json({ error: 'Error al registrar el acuse' }, { status: 500 })
  }
  return NextResponse.json({ ok: true, acknowledgedAt: ahora, text: texto }, { status: 201 })
}

const firmaSchema = z.object({
  profileId: z.string().uuid(),
  itemType: z.enum(['course', 'video']),
  itemId: z.string().min(1).max(64),
  note: z.string().max(1000).optional(),
  /** Retirar la firma (se equivocó de persona, o dejó de saber hacerlo). */
  revoke: z.boolean().optional(),
})

export async function PATCH(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!(await isOrgAdmin(user.id))) {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 })
  }

  const parsed = firmaSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  // Firmarse a si mismo vacía el sentido de la verificación: el punto es que
  // OTRA persona confirme que sabes hacerlo. Misma regla que ya rige la
  // revisión de cursos (prohibeAutorrevision en flujo-curso.ts).
  if (parsed.data.profileId === user.id && !parsed.data.revoke) {
    return NextResponse.json(
      { error: 'No puedes verificarte a ti mismo: la firma tiene que ser de otra persona.' },
      { status: 422 },
    )
  }

  const admin = createAdminClient()
  const ahora = new Date()

  if (parsed.data.revoke) {
    const { error } = await admin
      .from('academy_certifications')
      .update({ verified_at: null, verified_by: null, verified_note: null, expires_at: null, updated_at: ahora.toISOString() })
      .eq('profile_id', parsed.data.profileId)
      .eq('item_type', parsed.data.itemType)
      .eq('item_id', parsed.data.itemId)
    if (error) {
      console.error('[academy certifications PATCH revoke] error:', error)
      return NextResponse.json({ error: 'Error al retirar la firma' }, { status: 500 })
    }
    return NextResponse.json({ ok: true, revoked: true })
  }

  // El vencimiento sale de la regla del CONTENIDO, no del cliente.
  let meses: number | null = null
  if (parsed.data.itemType === 'video') {
    const { data: v } = await admin
      .from('academy_videos').select('valid_months').eq('id', parsed.data.itemId).maybeSingle()
    meses = v?.valid_months ?? null
  }
  const vence = calcularVencimiento(ahora, meses)

  const { error } = await admin
    .from('academy_certifications')
    .upsert({
      profile_id: parsed.data.profileId,
      item_type: parsed.data.itemType,
      item_id: parsed.data.itemId,
      verified_by: user.id,
      verified_at: ahora.toISOString(),
      verified_note: parsed.data.note?.trim() || null,
      expires_at: vence ? vence.toISOString() : null,
      updated_at: ahora.toISOString(),
    }, { onConflict: 'profile_id,item_type,item_id' })

  if (error) {
    console.error('[academy certifications PATCH] error:', error)
    return NextResponse.json({ error: 'Error al firmar' }, { status: 500 })
  }
  return NextResponse.json({
    ok: true,
    verifiedAt: ahora.toISOString(),
    expiresAt: vence ? vence.toISOString() : null,
  })
}

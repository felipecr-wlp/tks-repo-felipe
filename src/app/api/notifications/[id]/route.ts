/**
 * PATCH  /api/notifications/[id], marcar como leído/no leído o posponer (snooze)
 * DELETE /api/notifications/[id], eliminar notificación
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { id: string }
}

// Se acepta is_read, snoozed_until, o ambos. Al menos uno debe venir.
const patchSchema = z.object({
  is_read:       z.boolean().optional(),
  snoozed_until: z.string().datetime().nullable().optional(),
}).refine(
  v => v.is_read !== undefined || v.snoozed_until !== undefined,
  { message: 'Nada que actualizar' },
)

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })
  }

  const admin = createAdminClient()

  const update: Record<string, unknown> = {}
  if (parsed.data.is_read !== undefined) update.is_read = parsed.data.is_read
  if (parsed.data.snoozed_until !== undefined) {
    update.snoozed_until = parsed.data.snoozed_until
    // Al posponer, se marca leída para que no cuente como pendiente mientras
    // duerme (a menos que el cliente pida explícitamente is_read).
    if (parsed.data.snoozed_until && parsed.data.is_read === undefined) update.is_read = true
  }

  const { error } = await admin
    .from('notifications')
    .update(update as Database['public']['Tables']['notifications']['Update'])
    .eq('id', params.id)
    .eq('recipient_id', user.id)  // solo el destinatario puede modificar

  if (error) {
    return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.id)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { error } = await admin
    .from('notifications')
    .delete()
    .eq('id', params.id)
    .eq('recipient_id', user.id)

  if (error) {
    return NextResponse.json({ error: 'Error al eliminar' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

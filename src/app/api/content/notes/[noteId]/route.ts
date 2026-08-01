/**
 * PATCH /api/content/notes/[noteId]
 * Marca una correccion como atendida, o la reabre.
 *
 * Es el "trabajar en adecuaciones" del planificador. Se guarda QUIEN la atendio
 * y cuando, porque una correccion que se cierra sola no la revisa nadie.
 *
 * Reabrir esta permitido a proposito: cerrar por error es trivial y no deberia
 * costar volver a escribir la peticion desde cero.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { loadItemAccess } from '@/lib/content/access'

/** Un solo interruptor. `resolved_by` lo sella el servidor, no el cliente. */
const resolverSchema = z.object({
  resolved: z.boolean().default(true),
})

export async function PATCH(request: NextRequest, { params }: { params: { noteId: string } }) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  if (!isUuid(params.noteId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: note } = (await admin
    .from('content_notes')
    .select('id, item_id')
    .eq('id', params.noteId)
    .maybeSingle()) as { data: { id: string; item_id: string } | null }

  if (!note) return NextResponse.json({ error: 'Corrección no encontrada' }, { status: 404 })

  const acceso = await loadItemAccess(admin, note.item_id, user.id)
  if (!acceso || !acceso.isMember) {
    return NextResponse.json({ error: 'Corrección no encontrada' }, { status: 404 })
  }

  let crudo: unknown
  try {
    crudo = await request.json()
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const parsed = resolverSchema.safeParse(crudo)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 422 })
  }
  const resolver = parsed.data.resolved

  const { data: updated, error } = await admin
    .from('content_notes')
    .update({
      resolved_at: resolver ? new Date().toISOString() : null,
      resolved_by: resolver ? user.id : null,
    })
    .eq('id', params.noteId)
    .select('id, resolved_at')
    .single()

  if (error || !updated) {
    console.error('[content notes] update error:', error)
    return NextResponse.json({ error: 'No se pudo actualizar la corrección' }, { status: 500 })
  }

  return NextResponse.json({ note: updated })
}

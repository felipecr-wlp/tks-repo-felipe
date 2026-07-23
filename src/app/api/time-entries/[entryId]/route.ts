/**
 * PATCH  /api/time-entries/[entryId]  -> edita una entrada PROPIA
 *                                        { started_at?, ended_at?, note? }.
 * DELETE /api/time-entries/[entryId]  -> borra una entrada PROPIA.
 *
 * Seguridad: auth + la entrada debe ser del usuario (profile_id === user.id).
 * Un manager puede LEER las del proyecto (GET del timesheet), pero editar/borrar
 * solo el dueño. zod strict + rate limit.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import type { Database } from '@/lib/supabase/types'

const patchSchema = z.object({
  started_at: z.string().datetime().optional(),
  ended_at:   z.string().datetime().optional(),
  note:       z.string().max(1000).trim().nullable().optional(),
}).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: { entryId: string } }
) {
  if (!isUuid(params.entryId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }

  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('time_entries')
    .select('id, profile_id, started_at, ended_at')
    .eq('id', params.entryId)
    .maybeSingle() as { data: { id: string; profile_id: string; started_at: string; ended_at: string | null } | null }

  if (!existing) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 })
  if (existing.profile_id !== user.id) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Resolver los tiempos efectivos tras la edicion para recalcular duracion.
  const nextStart = parsed.data.started_at ?? existing.started_at
  const nextEnd = parsed.data.ended_at ?? existing.ended_at

  const patch: Database['public']['Tables']['time_entries']['Update'] = { ...parsed.data }
  if (nextEnd) {
    const startMs = new Date(nextStart).getTime()
    const endMs = new Date(nextEnd).getTime()
    if (endMs <= startMs) {
      return NextResponse.json({ error: 'La hora de fin debe ser posterior al inicio' }, { status: 422 })
    }
    patch.duration_sec = Math.round((endMs - startMs) / 1000)
  }

  const { data: entry, error } = await admin
    .from('time_entries')
    .update(patch)
    .eq('id', params.entryId)
    .eq('profile_id', user.id)
    .select('id, task_id, project_id, workspace_id, started_at, ended_at, duration_sec, note, created_at')
    .single()

  if (error || !entry) {
    console.error('[time-entries PATCH] error:', error)
    return NextResponse.json({ error: 'Error al actualizar la entrada' }, { status: 500 })
  }

  return NextResponse.json(entry)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { entryId: string } }
) {
  if (!isUuid(params.entryId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: existing } = await admin
    .from('time_entries')
    .select('id, profile_id')
    .eq('id', params.entryId)
    .maybeSingle() as { data: { id: string; profile_id: string } | null }

  if (!existing) return NextResponse.json({ error: 'Entrada no encontrada' }, { status: 404 })
  if (existing.profile_id !== user.id) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const { error } = await admin
    .from('time_entries')
    .delete()
    .eq('id', params.entryId)
    .eq('profile_id', user.id)

  if (error) {
    console.error('[time-entries DELETE] error:', error)
    return NextResponse.json({ error: 'Error al borrar la entrada' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

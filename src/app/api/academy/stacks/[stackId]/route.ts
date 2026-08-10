/**
 * /api/academy/stacks/[stackId]  (solo admin)
 *
 * PATCH  renombra, re-describe, re-colorea o reordena un stack. Pensado para
 *        cuando lleguen los nombres definitivos: renombrar no toca los videos.
 * DELETE borra el stack; sus videos QUEDAN (FK ON DELETE SET NULL) y pasan a
 *        la seccion de sueltos. Borrar una carpeta no quema su contenido.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { isOrgAdmin } from '@/lib/team-access'
import type { Database } from '@/lib/supabase/types'

type StackUpdate = Database['public']['Tables']['academy_stacks']['Update']

const COLUMNAS = 'id, title, description, accent, position, school_id, created_by, created_at, updated_at'

const patchSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  description: z.string().max(1000).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0).max(10000).optional(),
  schoolId: z.string().uuid().nullable().optional(),
})

async function gateAdmin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { fail: NextResponse.json({ error: 'No autenticado' }, { status: 401 }) }
  if (!(await isOrgAdmin(user.id))) {
    return { fail: NextResponse.json({ error: 'Solo administradores' }, { status: 403 }) }
  }
  return { user }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { stackId: string } },
) {
  if (!isUuid(params.stackId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const gate = await gateAdmin()
  if ('fail' in gate) return gate.fail

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })
  }

  const cambios: StackUpdate = { updated_at: new Date().toISOString() }
  if (parsed.data.title !== undefined) cambios.title = parsed.data.title.trim()
  if (parsed.data.description !== undefined) cambios.description = parsed.data.description.trim()
  if (parsed.data.accent !== undefined) cambios.accent = parsed.data.accent
  if (parsed.data.position !== undefined) cambios.position = parsed.data.position
  if (parsed.data.schoolId !== undefined) cambios.school_id = parsed.data.schoolId

  const admin = createAdminClient()
  const { data: fila, error } = await admin
    .from('academy_stacks')
    .update(cambios)
    .eq('id', params.stackId)
    .select(COLUMNAS)
    .maybeSingle()

  if (error) {
    console.error('[academy stacks PATCH] error:', error)
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
  }
  if (!fila) return NextResponse.json({ error: 'Stack no encontrado' }, { status: 404 })
  return NextResponse.json({ stack: fila })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { stackId: string } },
) {
  if (!isUuid(params.stackId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const gate = await gateAdmin()
  if ('fail' in gate) return gate.fail

  const admin = createAdminClient()
  const { data: fila, error } = await admin
    .from('academy_stacks')
    .delete()
    .eq('id', params.stackId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('[academy stacks DELETE] error:', error)
    return NextResponse.json({ error: 'Error al borrar' }, { status: 500 })
  }
  if (!fila) return NextResponse.json({ error: 'Stack no encontrado' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

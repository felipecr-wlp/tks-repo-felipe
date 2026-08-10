/**
 * PATCH /api/academy/schools/[schoolId]  (solo admin)
 *
 * Renombrar, redescribir, recolorear o reordenar una escuela. NO hay DELETE a
 * proposito: las 14 escuelas son la estructura acordada con Fred, no algo que
 * se borre desde una pantalla. Si alguna sobra, se queda vacia y se ve como
 * "todavía sin contenido", que es informacion util. Borrarlas dejaria stacks
 * huerfanos y un mapa incompleto sin rastro de por que.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { isOrgAdmin } from '@/lib/team-access'
import type { Database } from '@/lib/supabase/types'

type EscuelaUpdate = Database['public']['Tables']['academy_schools']['Update']

const COLUMNAS = 'id, code, title, description, accent, mandatory, position, created_at, updated_at'

const patchSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(1000).optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  mandatory: z.boolean().optional(),
  position: z.number().int().min(0).max(10000).optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: { schoolId: string } },
) {
  if (!isUuid(params.schoolId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!(await isOrgAdmin(user.id))) {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 })
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const cambios: EscuelaUpdate = { updated_at: new Date().toISOString() }
  if (parsed.data.title !== undefined) cambios.title = parsed.data.title.trim()
  if (parsed.data.description !== undefined) cambios.description = parsed.data.description.trim()
  if (parsed.data.accent !== undefined) cambios.accent = parsed.data.accent
  if (parsed.data.mandatory !== undefined) cambios.mandatory = parsed.data.mandatory
  if (parsed.data.position !== undefined) cambios.position = parsed.data.position

  const admin = createAdminClient()
  const { data: fila, error } = await admin
    .from('academy_schools')
    .update(cambios)
    .eq('id', params.schoolId)
    .select(COLUMNAS)
    .maybeSingle()

  if (error) {
    console.error('[academy schools PATCH] error:', error)
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
  }
  if (!fila) return NextResponse.json({ error: 'Escuela no encontrada' }, { status: 404 })
  return NextResponse.json({ school: fila })
}

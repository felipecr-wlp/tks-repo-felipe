/**
 * /api/academy/paths/[pathId]  (solo admin)
 * PATCH  editar la ruta (titulo, escuela, video de entrada, estado, orden).
 * DELETE borrar la ruta. Los videos NO se tocan: una ruta es una puerta, no
 *        un contenedor. Borrarla no puede borrar el curso.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { isOrgAdmin } from '@/lib/team-access'
import type { Database } from '@/lib/supabase/types'
import { COLUMNAS_RUTA } from '../route'

type RutaUpdate = Database['public']['Tables']['academy_paths']['Update']

const patchSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(1000).optional(),
  schoolId: z.string().uuid().nullable().optional(),
  entryVideoId: z.string().uuid().nullable().optional(),
  accent: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().int().min(0).max(10000).optional(),
  status: z.enum(['draft', 'live']).optional(),
})

async function gate() {
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
  { params }: { params: { pathId: string } },
) {
  if (!isUuid(params.pathId)) return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  const limited = await applyRateLimit(request)
  if (limited) return limited
  const g = await gate()
  if ('fail' in g) return g.fail

  const parsed = patchSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()
  const cambios: RutaUpdate = { updated_at: new Date().toISOString() }
  if (parsed.data.title !== undefined) cambios.title = parsed.data.title.trim()
  if (parsed.data.description !== undefined) cambios.description = parsed.data.description.trim()
  if (parsed.data.schoolId !== undefined) cambios.school_id = parsed.data.schoolId
  if (parsed.data.accent !== undefined) cambios.accent = parsed.data.accent
  if (parsed.data.position !== undefined) cambios.position = parsed.data.position
  if (parsed.data.status !== undefined) cambios.status = parsed.data.status

  if (parsed.data.entryVideoId !== undefined) {
    if (parsed.data.entryVideoId !== null) {
      const { data: v } = await admin
        .from('academy_videos').select('id').eq('id', parsed.data.entryVideoId).maybeSingle()
      if (!v) return NextResponse.json({ error: 'El video de entrada no existe' }, { status: 422 })
    }
    cambios.entry_video_id = parsed.data.entryVideoId
  }

  // Publicar una ruta SIN entrada es publicar una puerta que no abre a nada.
  // Se comprueba contra el estado resultante, no solo contra lo que llego en
  // este PATCH: publicar sin tocar la entrada tambien tiene que fallar.
  if ((cambios.status ?? null) === 'live') {
    const entradaFinal = parsed.data.entryVideoId !== undefined
      ? parsed.data.entryVideoId
      : (await admin.from('academy_paths').select('entry_video_id').eq('id', params.pathId).maybeSingle()).data?.entry_video_id ?? null
    if (!entradaFinal) {
      return NextResponse.json({ error: 'No se puede publicar una ruta sin video de entrada' }, { status: 422 })
    }
  }

  const { data: fila, error } = await admin
    .from('academy_paths').update(cambios).eq('id', params.pathId).select(COLUMNAS_RUTA).maybeSingle()

  if (error) {
    console.error('[academy paths PATCH] error:', error)
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
  }
  if (!fila) return NextResponse.json({ error: 'Ruta no encontrada' }, { status: 404 })
  return NextResponse.json({ path: fila })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { pathId: string } },
) {
  if (!isUuid(params.pathId)) return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  const limited = await applyRateLimit(request)
  if (limited) return limited
  const g = await gate()
  if ('fail' in g) return g.fail

  const admin = createAdminClient()
  const { data: fila, error } = await admin
    .from('academy_paths').delete().eq('id', params.pathId).select('id').maybeSingle()

  if (error) {
    console.error('[academy paths DELETE] error:', error)
    return NextResponse.json({ error: 'Error al borrar' }, { status: 500 })
  }
  if (!fila) return NextResponse.json({ error: 'Ruta no encontrada' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

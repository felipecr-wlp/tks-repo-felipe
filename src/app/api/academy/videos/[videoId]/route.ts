/**
 * /api/academy/videos/[videoId]  (solo admin)
 *
 * PATCH  edita metadatos: titulo, descripcion, capitulos, tags, estado,
 *        duracion. NO cambia storage_path: reemplazar el binario es subir un
 *        video nuevo, no mutar uno existente (el historial de avance de la
 *        gente pertenece a LO QUE VIERON).
 * DELETE borra la fila y los objetos de storage. El avance cae por FK CASCADE.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { isOrgAdmin } from '@/lib/team-access'
import { VIDEO_BUCKET, validarCapitulos, validarInteracciones } from '@/lib/academy/videos'
import type { Database, Json } from '@/lib/supabase/types'

type VideoUpdate = Database['public']['Tables']['academy_videos']['Update']

const patchSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).optional(),
  durationSeconds: z.number().int().min(0).nullable().optional(),
  chapters: z.unknown().optional(),
  interactions: z.unknown().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  stackId: z.string().uuid().nullable().optional(),
  status: z.enum(['draft', 'live']).optional(),
})

/** Sesion + admin de la org. El rate limit y el uuid van en CADA handler, en
    su cuerpo: los tripwires de cobertura escanean por handler y un helper se
    los esconderia. */
async function requireAdmin() {
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
  { params }: { params: { videoId: string } },
) {
  if (!isUuid(params.videoId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const gate = await requireAdmin()
  if ('fail' in gate) return gate.fail

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const cambios: VideoUpdate = { updated_at: new Date().toISOString() }
  if (parsed.data.title !== undefined) cambios.title = parsed.data.title.trim()
  if (parsed.data.description !== undefined) cambios.description = parsed.data.description.trim()
  if (parsed.data.durationSeconds !== undefined) cambios.duration_seconds = parsed.data.durationSeconds
  if (parsed.data.tags !== undefined) cambios.tags = parsed.data.tags
  if (parsed.data.status !== undefined) cambios.status = parsed.data.status
  if (parsed.data.chapters !== undefined) {
    const capitulos = validarCapitulos(parsed.data.chapters)
    if (capitulos === null) {
      return NextResponse.json({ error: 'Capítulos inválidos' }, { status: 422 })
    }
    // Capitulo[] es estructuralmente Json valido; el cast es solo porque el
    // tipo generado no puede saberlo.
    cambios.chapters = capitulos as unknown as Json
  }
  if (parsed.data.interactions !== undefined) {
    const interacciones = validarInteracciones(parsed.data.interactions)
    if (interacciones === null) {
      return NextResponse.json({ error: 'Interacciones inválidas' }, { status: 422 })
    }
    cambios.interactions = interacciones as unknown as Json
  }
  if (parsed.data.stackId !== undefined) {
    if (parsed.data.stackId !== null) {
      const adminCheck = createAdminClient()
      const { data: stack } = await adminCheck
        .from('academy_stacks')
        .select('id')
        .eq('id', parsed.data.stackId)
        .maybeSingle()
      if (!stack) return NextResponse.json({ error: 'Stack no encontrado' }, { status: 422 })
    }
    cambios.stack_id = parsed.data.stackId
  }

  const admin = createAdminClient()
  const { data: fila, error } = await admin
    .from('academy_videos')
    .update(cambios)
    .eq('id', params.videoId)
    .select('id, title, description, storage_path, thumbnail_path, duration_seconds, chapters, interactions, tags, stack_id, status, created_by, created_at, updated_at')
    .maybeSingle()

  if (error) {
    console.error('[academy videos PATCH] error:', error)
    return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
  }
  if (!fila) return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 })

  return NextResponse.json({ video: fila })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { videoId: string } },
) {
  if (!isUuid(params.videoId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const gate = await requireAdmin()
  if ('fail' in gate) return gate.fail

  const admin = createAdminClient()
  const { data: fila } = await admin
    .from('academy_videos')
    .select('storage_path, thumbnail_path')
    .eq('id', params.videoId)
    .maybeSingle()

  if (!fila) return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 })

  const { error } = await admin.from('academy_videos').delete().eq('id', params.videoId)
  if (error) {
    console.error('[academy videos DELETE] error:', error)
    return NextResponse.json({ error: 'Error al borrar' }, { status: 500 })
  }

  // Limpieza de storage best-effort DESPUES de borrar la fila: si esto falla
  // queda un objeto huerfano (costo de storage), nunca una tarjeta rota.
  const paths = [fila.storage_path, fila.thumbnail_path].filter(
    (p): p is string => typeof p === 'string' && p.length > 0,
  )
  if (paths.length > 0) {
    const { error: se } = await admin.storage.from(VIDEO_BUCKET).remove(paths)
    if (se) console.error('[academy videos DELETE] storage cleanup:', se)
  }

  return NextResponse.json({ ok: true })
}

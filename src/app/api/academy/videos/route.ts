/**
 * /api/academy/videos
 *
 * GET   lista la galeria: videos 'live' para cualquier usuario autenticado
 *       (los borradores solo para admin) + el avance PROPIO por video.
 * POST  (solo admin) registra un video ya subido a Storage por upload-url.
 *       Antes de insertar VERIFICA que el objeto exista de verdad: registrar
 *       un path fantasma daria una tarjeta que revienta al reproducir, con
 *       sintomas que no se parecen a la causa.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isOrgAdmin } from '@/lib/team-access'
import type { Json } from '@/lib/supabase/types'
import {
  VIDEO_BUCKET,
  validarCapitulos,
  validarInteracciones,
  type AvanceVideo,
  type VideoAcademia,
} from '@/lib/academy/videos'

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const esAdmin = await isOrgAdmin(user.id)

  let q = admin
    .from('academy_videos')
    .select('id, title, description, storage_path, thumbnail_path, duration_seconds, chapters, interactions, tags, stack_id, status, created_by, created_at, updated_at')
    .order('created_at', { ascending: false })
  if (!esAdmin) q = q.eq('status', 'live')

  const [{ data: videos, error: e1 }, { data: avances, error: e2 }] = await Promise.all([
    q,
    admin
      .from('academy_video_progress')
      .select('video_id, last_position, seconds_watched, completed, updated_at')
      .eq('profile_id', user.id),
  ])

  if (e1 || e2) {
    console.error('[academy videos GET] error:', e1 ?? e2)
    return NextResponse.json({ error: 'Error al cargar la galería' }, { status: 500 })
  }

  return NextResponse.json({
    videos: (videos ?? []) as unknown as VideoAcademia[],
    avances: (avances ?? []) as unknown as AvanceVideo[],
    esAdmin,
  })
}

const crearSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().max(2000).optional().default(''),
  path: z.string().min(1).max(500),
  thumbnailPath: z.string().min(1).max(500).nullable().optional(),
  durationSeconds: z.number().int().min(0).nullable().optional(),
  chapters: z.unknown().optional(),
  interactions: z.unknown().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional().default([]),
  stackId: z.string().uuid().nullable().optional(),
  status: z.enum(['draft', 'live']).optional().default('live'),
})

/** El objeto existe si Storage puede firmarle una URL. */
async function existeEnStorage(
  admin: ReturnType<typeof createAdminClient>,
  path: string,
): Promise<boolean> {
  const { data, error } = await admin.storage.from(VIDEO_BUCKET).createSignedUrl(path, 60)
  return !error && Boolean(data?.signedUrl)
}

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  if (!(await isOrgAdmin(user.id))) {
    return NextResponse.json({ error: 'Solo administradores' }, { status: 403 })
  }

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = crearSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  // Solo paths que emitio upload-url: bajo videos/ (y thumbs/ para miniatura).
  if (!parsed.data.path.startsWith('videos/')) {
    return NextResponse.json({ error: 'Path inválido' }, { status: 422 })
  }
  const thumb = parsed.data.thumbnailPath ?? null
  if (thumb !== null && !thumb.startsWith('thumbs/')) {
    return NextResponse.json({ error: 'Path de miniatura inválido' }, { status: 422 })
  }

  const capitulos = validarCapitulos(parsed.data.chapters ?? [])
  if (capitulos === null) {
    return NextResponse.json({ error: 'Capítulos inválidos' }, { status: 422 })
  }
  const interacciones = validarInteracciones(parsed.data.interactions ?? [])
  if (interacciones === null) {
    return NextResponse.json({ error: 'Interacciones inválidas' }, { status: 422 })
  }

  const admin = createAdminClient()
  const stackId = parsed.data.stackId ?? null
  if (stackId !== null) {
    const { data: stack } = await admin
      .from('academy_stacks')
      .select('id')
      .eq('id', stackId)
      .maybeSingle()
    if (!stack) return NextResponse.json({ error: 'Stack no encontrado' }, { status: 422 })
  }
  if (!(await existeEnStorage(admin, parsed.data.path))) {
    return NextResponse.json({ error: 'El video no está en storage' }, { status: 422 })
  }
  if (thumb !== null && !(await existeEnStorage(admin, thumb))) {
    return NextResponse.json({ error: 'La miniatura no está en storage' }, { status: 422 })
  }

  const { data: fila, error } = await admin
    .from('academy_videos')
    .insert({
      title: parsed.data.title.trim(),
      description: parsed.data.description.trim(),
      storage_path: parsed.data.path,
      thumbnail_path: thumb,
      duration_seconds: parsed.data.durationSeconds ?? null,
      // Capitulo[] / Interaccion[] son Json validos; el tipo generado no puede saberlo.
      chapters: capitulos as unknown as Json,
      interactions: interacciones as unknown as Json,
      tags: parsed.data.tags,
      stack_id: stackId,
      status: parsed.data.status,
      created_by: user.id,
    })
    .select('id, title, description, storage_path, thumbnail_path, duration_seconds, chapters, interactions, tags, stack_id, status, created_by, created_at, updated_at')
    .single()

  if (error || !fila) {
    console.error('[academy videos POST] insert error:', error)
    return NextResponse.json({ error: 'Error al registrar el video' }, { status: 500 })
  }

  return NextResponse.json({ video: fila as unknown as VideoAcademia }, { status: 201 })
}

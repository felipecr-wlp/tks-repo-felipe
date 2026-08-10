/**
 * POST /api/academy/videos/[videoId]/progress  { position, watched, ended? }
 *
 * El usuario guarda SU avance. Upsert idempotente por (profile_id, video_id).
 *
 * Reglas del lado servidor, no del cliente:
 *   - seconds_watched es MONOTONICO: se guarda el maximo entre lo previo y lo
 *     reportado. Retroceder la barra no des-ve un video.
 *   - completed tambien es monotonico (una vez visto, visto) y se DERIVA aqui:
 *     ended explicito, o cobertura >= FRACCION_COMPLETADO de la duracion
 *     conocida. El cliente no puede declararse "completado" por decreto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { FRACCION_COMPLETADO } from '@/lib/academy/videos'

const schema = z.object({
  position: z.number().int().min(0).max(60 * 60 * 24),
  watched: z.number().int().min(0).max(60 * 60 * 24),
  ended: z.boolean().optional().default(false),
})

export async function POST(
  request: NextRequest,
  { params }: { params: { videoId: string } },
) {
  if (!isUuid(params.videoId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const parsed = schema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })
  }

  const admin = createAdminClient()
  const { data: video } = await admin
    .from('academy_videos')
    .select('status, duration_seconds')
    .eq('id', params.videoId)
    .maybeSingle()

  if (!video) return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 })
  if (video.status !== 'live') {
    // Un borrador no acumula avance de nadie: cuando se publique, todos
    // empiezan desde cero de verdad.
    return NextResponse.json({ error: 'Video no disponible' }, { status: 403 })
  }

  const { data: previo } = await admin
    .from('academy_video_progress')
    .select('seconds_watched, completed')
    .eq('profile_id', user.id)
    .eq('video_id', params.videoId)
    .maybeSingle()

  const watched = Math.max(parsed.data.watched, previo?.seconds_watched ?? 0)
  const porCobertura =
    typeof video.duration_seconds === 'number' &&
    video.duration_seconds > 0 &&
    watched >= video.duration_seconds * FRACCION_COMPLETADO
  const completed = Boolean(previo?.completed) || parsed.data.ended || porCobertura

  const { error } = await admin
    .from('academy_video_progress')
    .upsert(
      {
        profile_id: user.id,
        video_id: params.videoId,
        last_position: parsed.data.position,
        seconds_watched: watched,
        completed,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'profile_id,video_id' },
    )

  if (error) {
    console.error('[academy videos progress] upsert error:', error)
    return NextResponse.json({ error: 'Error al guardar avance' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, completed })
}

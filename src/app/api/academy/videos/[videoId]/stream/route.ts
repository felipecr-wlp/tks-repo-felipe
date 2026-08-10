/**
 * GET /api/academy/videos/[videoId]/stream
 *
 * URLs firmadas de reproduccion (video + miniatura) para cualquier usuario
 * autenticado, si el video esta 'live' (borradores: solo admin). El <video>
 * nativo pide rangos (Range) y Storage los honra, asi que seek funciona sin
 * descargar el archivo entero.
 *
 * TTL 4h: mas corto obligaria a re-pedir en videos largos a media vista; mas
 * largo alarga la ventana en que una URL copiada sigue viva. Para capacitacion
 * interna es el punto medio razonable, no DRM.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid } from '@/lib/validation'
import { isOrgAdmin } from '@/lib/team-access'
import { VIDEO_BUCKET } from '@/lib/academy/videos'

const TTL_SEGUNDOS = 4 * 60 * 60

export async function GET(
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

  const admin = createAdminClient()
  const { data: video } = await admin
    .from('academy_videos')
    .select('storage_path, thumbnail_path, status')
    .eq('id', params.videoId)
    .maybeSingle()

  if (!video) return NextResponse.json({ error: 'Video no encontrado' }, { status: 404 })

  if (video.status !== 'live' && !(await isOrgAdmin(user.id))) {
    return NextResponse.json({ error: 'Video no disponible' }, { status: 403 })
  }

  const { data: signed, error } = await admin
    .storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(video.storage_path, TTL_SEGUNDOS)

  if (error || !signed?.signedUrl) {
    console.error('[academy videos stream] sign error:', error)
    return NextResponse.json({ error: 'Error al preparar la reproducción' }, { status: 500 })
  }

  let thumbnailUrl: string | null = null
  if (video.thumbnail_path) {
    const { data: st } = await admin
      .storage
      .from(VIDEO_BUCKET)
      .createSignedUrl(video.thumbnail_path, TTL_SEGUNDOS)
    thumbnailUrl = st?.signedUrl ?? null
  }

  return NextResponse.json({ url: signed.signedUrl, thumbnailUrl })
}

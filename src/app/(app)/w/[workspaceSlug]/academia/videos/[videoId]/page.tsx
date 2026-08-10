/**
 * Reproductor de un video de la galeria. El server valida sesion + membresia,
 * carga el video (borradores solo admin) y FIRMA las URLs aqui: el reproductor
 * arranca sin un fetch extra de ida y vuelta.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { isOrgAdmin } from '@/lib/team-access'
import { isUuid } from '@/lib/validation'
import {
  VIDEO_BUCKET,
  validarCapitulos,
  type AvanceVideo,
  type VideoAcademia,
} from '@/lib/academy/videos'
import { ReproductorVideo } from './ReproductorVideo'

interface PageProps {
  params: { workspaceSlug: string; videoId: string }
}

const TTL_REPRODUCCION = 4 * 60 * 60

export default async function VideoPage({ params }: PageProps) {
  if (!isUuid(params.videoId)) notFound()

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()
  type WsRow = { workspaces: { id: string } | null }
  const { data: row } = (await admin
    .from('workspace_members')
    .select('workspaces!inner ( id )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle()) as { data: WsRow | null }
  if (!row?.workspaces) redirect('/')

  const { data: videoRaw } = await admin
    .from('academy_videos')
    .select('id, title, description, storage_path, thumbnail_path, duration_seconds, chapters, tags, status, created_by, created_at, updated_at')
    .eq('id', params.videoId)
    .maybeSingle()
  if (!videoRaw) notFound()

  const video = videoRaw as unknown as VideoAcademia
  if (video.status !== 'live' && !(await isOrgAdmin(user.id))) notFound()

  const [{ data: avanceRaw }, { data: firmado }] = await Promise.all([
    admin
      .from('academy_video_progress')
      .select('video_id, last_position, seconds_watched, completed, updated_at')
      .eq('profile_id', user.id)
      .eq('video_id', video.id)
      .maybeSingle(),
    admin.storage.from(VIDEO_BUCKET).createSignedUrl(video.storage_path, TTL_REPRODUCCION),
  ])

  if (!firmado?.signedUrl) {
    // Fila sin objeto: mejor 404 claro que un reproductor que gira infinito.
    console.error('[video page] no se pudo firmar', video.storage_path)
    notFound()
  }

  let posterUrl: string | null = null
  if (video.thumbnail_path) {
    const { data: st } = await admin
      .storage
      .from(VIDEO_BUCKET)
      .createSignedUrl(video.thumbnail_path, TTL_REPRODUCCION)
    posterUrl = st?.signedUrl ?? null
  }

  return (
    <ReproductorVideo
      workspaceSlug={params.workspaceSlug}
      video={{ ...video, chapters: validarCapitulos(video.chapters) ?? [] }}
      avance={(avanceRaw as unknown as AvanceVideo) ?? null}
      streamUrl={firmado.signedUrl}
      posterUrl={posterUrl}
    />
  )
}

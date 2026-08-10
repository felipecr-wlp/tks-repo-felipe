/**
 * Galeria de videos de la Academia. El server valida sesion + membresia
 * (anti-IDOR por slug, mismo patron que academia/page.tsx), carga catalogo y
 * avance propio, y FIRMA las miniaturas aqui: la cuadricula pinta completa en
 * el primer render, sin una cascada de fetches por tarjeta.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { isOrgAdmin } from '@/lib/team-access'
import {
  VIDEO_BUCKET,
  type AvanceVideo,
  type EscuelaAcademia,
  type StackAcademia,
  type VideoAcademia,
} from '@/lib/academy/videos'
import { GaleriaVideos } from './GaleriaVideos'

interface PageProps {
  params: { workspaceSlug: string }
}

const TTL_MINIATURA = 60 * 60

export default async function VideosPage({ params }: PageProps) {
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

  const esAdmin = await isOrgAdmin(user.id)

  let q = admin
    .from('academy_videos')
    .select('id, title, description, storage_path, thumbnail_path, duration_seconds, chapters, interactions, tags, stack_id, status, created_by, created_at, updated_at')
    .order('created_at', { ascending: false })
  if (!esAdmin) q = q.eq('status', 'live')

  const [{ data: videosRaw }, { data: avancesRaw }, { data: stacksRaw }, { data: escuelasRaw }] = await Promise.all([
    q,
    admin
      .from('academy_video_progress')
      .select('video_id, last_position, seconds_watched, completed, updated_at')
      .eq('profile_id', user.id),
    admin
      .from('academy_stacks')
      .select('id, title, description, accent, position, school_id, created_by, created_at, updated_at')
      .order('position', { ascending: true }),
    admin
      .from('academy_schools')
      .select('id, code, title, description, accent, mandatory, position, created_at, updated_at')
      .order('position', { ascending: true }),
  ])

  const videos = (videosRaw ?? []) as unknown as VideoAcademia[]
  const avances = (avancesRaw ?? []) as unknown as AvanceVideo[]
  const stacks = (stacksRaw ?? []) as unknown as StackAcademia[]
  const escuelas = (escuelasRaw ?? []) as unknown as EscuelaAcademia[]

  // Miniaturas en lote: una llamada, no una por tarjeta.
  const conThumb = videos.filter((v) => v.thumbnail_path)
  const thumbUrls: Record<string, string> = {}
  if (conThumb.length > 0) {
    const { data: firmadas } = await admin
      .storage
      .from(VIDEO_BUCKET)
      .createSignedUrls(conThumb.map((v) => v.thumbnail_path as string), TTL_MINIATURA)
    if (firmadas) {
      conThumb.forEach((v, i) => {
        const url = firmadas[i]?.signedUrl
        if (url) thumbUrls[v.id] = url
      })
    }
  }

  return (
    <GaleriaVideos
      workspaceSlug={params.workspaceSlug}
      videos={videos}
      avances={avances}
      stacks={stacks}
      escuelas={escuelas}
      thumbUrls={thumbUrls}
      esAdmin={esAdmin}
    />
  )
}

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
  validarInteracciones,
  type AvanceVideo,
  type VideoAcademia,
} from '@/lib/academy/videos'
import { puedeVer, type Espectador } from '@/lib/academy/visibilidad'
import { urlDeReproduccion } from '@/lib/academy/url-firmada'
import type { Certificacion } from '@/lib/academy/certificacion'
import { ReproductorVideo } from './ReproductorVideo'
import { PanelCertificacion } from './PanelCertificacion'

interface PageProps {
  params: { workspaceSlug: string; videoId: string }
  /** `de` = video del que se ramifico; `t` = segundo de arranque pedido. */
  searchParams: { de?: string; t?: string }
}

const TTL_REPRODUCCION = 4 * 60 * 60

export default async function VideoPage({ params, searchParams }: PageProps) {
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
    .select('id, title, description, storage_path, thumbnail_path, duration_seconds, chapters, interactions, tags, stack_id, status, audience, audience_profiles, diagram_x, diagram_y, requires_ack, requires_verification, valid_months, ack_text, signed_url, signed_url_expires_at, created_by, created_at, updated_at')
    .eq('id', params.videoId)
    .maybeSingle()
  if (!videoRaw) notFound()

  const video = videoRaw as unknown as VideoAcademia

  // LA BARRERA DE VERDAD ESTA AQUI, no en el filtro de la galeria. Esconder
  // una tarjeta no impide abrir el enlace directo, y los enlaces se comparten
  // por WhatsApp. Sin este check, "solo para foremen" seria decorativo.
  const [esAdmin, { data: perfil }, { data: nombrada }] = await Promise.all([
    isOrgAdmin(user.id),
    admin.from('profiles').select('academy_profiles').eq('id', user.id).maybeSingle(),
    admin.from('academy_video_viewers')
      .select('video_id').eq('profile_id', user.id).eq('video_id', video.id),
  ])
  const espectador: Espectador = {
    perfiles: (perfil?.academy_profiles ?? []) as string[],
    nombradaEn: new Set((nombrada ?? []).map((r) => r.video_id)),
    esAdmin,
  }
  // 404 y no 403: un 403 confirmaria que el video existe y de que trata.
  if (!puedeVer(video, video.id, espectador)) notFound()

  const [{ data: avanceRaw }, { data: certRaw }] = await Promise.all([
    admin
      .from('academy_video_progress')
      .select('video_id, last_position, seconds_watched, completed, updated_at')
      .eq('profile_id', user.id)
      .eq('video_id', video.id)
      .maybeSingle(),
    admin
      .from('academy_certifications')
      .select('profile_id, item_type, item_id, acknowledged_at, verified_at, verified_by, expires_at')
      .eq('profile_id', user.id)
      .eq('item_type', 'video')
      .eq('item_id', video.id)
      .maybeSingle(),
  ])

  // URL REUSABLE: la misma cadena para todos mientras siga vigente, para que
  // el cache del navegador sirva. Firmar en cada carga hacia que cada visita
  // volviera a descargar el video entero (ver lib/academy/url-firmada.ts).
  const streamUrl = await urlDeReproduccion(admin, video.id, {
    storage_path: video.storage_path,
    signed_url: (videoRaw as { signed_url?: string | null }).signed_url ?? null,
    signed_url_expires_at: (videoRaw as { signed_url_expires_at?: string | null }).signed_url_expires_at ?? null,
  })
  if (!streamUrl) {
    // Fila sin objeto: mejor 404 claro que un reproductor que gira infinito.
    console.error('[video page] no se pudo firmar', video.storage_path)
    notFound()
  }

  // De donde se vino por ramificacion. Se resuelve el TITULO en el server:
  // el enlace de regreso tiene que decir a que vuelves, no un uuid. Si el
  // origen ya no existe, simplemente no hay enlace de regreso (no es un error).
  let vieneDe: { id: string; title: string } | null = null
  if (searchParams.de && isUuid(searchParams.de) && searchParams.de !== params.videoId) {
    const { data: origen } = await admin
      .from('academy_videos')
      .select('id, title')
      .eq('id', searchParams.de)
      .maybeSingle()
    if (origen) vieneDe = { id: origen.id, title: origen.title }
  }

  // Segundo de arranque pedido por la rama. Se acota a la duracion conocida:
  // un `t` inventado a mano en la URL no debe dejar el video en un punto
  // muerto despues del final.
  let arranqueEn: number | null = null
  if (searchParams.t !== undefined) {
    const n = Number.parseInt(searchParams.t, 10)
    if (Number.isFinite(n) && n >= 0) {
      const dur = video.duration_seconds ?? 0
      arranqueEn = dur > 0 ? Math.min(n, Math.max(0, dur - 1)) : n
    }
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
      video={{
        ...video,
        chapters: validarCapitulos(video.chapters) ?? [],
        interactions: validarInteracciones(video.interactions) ?? [],
      }}
      avance={(avanceRaw as unknown as AvanceVideo) ?? null}
      streamUrl={streamUrl}
      posterUrl={posterUrl}
      vieneDe={vieneDe}
      arranqueEn={arranqueEn}
    >
      <PanelCertificacion
        videoId={video.id}
        requisitos={{
          requires_ack: video.requires_ack,
          requires_verification: video.requires_verification,
          valid_months: video.valid_months,
        }}
        cert={(certRaw as unknown as Certificacion) ?? null}
        textoAcuse={
          video.ack_text?.trim() ||
          'Confirmo que vi el contenido, lo entendí y me comprometo a aplicarlo.'
        }
        visto={Boolean((avanceRaw as unknown as AvanceVideo)?.completed)}
        // El "ahora" viene del SERVIDOR: con el reloj del navegador, alguien
        // podria adelantar la fecha y ver su certificacion vencida (o al
        // reves) sin que eso signifique nada.
        ahoraIso={new Date().toISOString()}
      />
    </ReproductorVideo>
  )
}

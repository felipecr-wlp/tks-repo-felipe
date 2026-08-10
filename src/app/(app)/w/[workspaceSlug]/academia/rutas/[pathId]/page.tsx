/**
 * Una ruta de aprendizaje: el mapa del arbol de decisiones y por donde vas.
 * El arbol se DERIVA de los enlaces de las interacciones, no se guarda (ver
 * lib/academy/rutas.ts para por que).
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { isOrgAdmin } from '@/lib/team-access'
import { isUuid } from '@/lib/validation'
import {
  validarInteracciones,
  type AvanceVideo,
  type RutaAcademia,
  type VideoAcademia,
} from '@/lib/academy/videos'
import { construirArbol, siguientePaso } from '@/lib/academy/rutas'
import { VistaRuta } from './VistaRuta'

interface PageProps {
  params: { workspaceSlug: string; pathId: string }
}

export default async function RutaPage({ params }: PageProps) {
  if (!isUuid(params.pathId)) notFound()

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()
  type WsRow = { workspaces: { id: string } | null }
  const { data: ws } = (await admin
    .from('workspace_members')
    .select('workspaces!inner ( id )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle()) as { data: WsRow | null }
  if (!ws?.workspaces) redirect('/')

  const esAdmin = await isOrgAdmin(user.id)

  const { data: rutaRaw } = await admin
    .from('academy_paths')
    .select('id, title, description, school_id, entry_video_id, accent, position, status, created_by, created_at, updated_at')
    .eq('id', params.pathId)
    .maybeSingle()

  if (!rutaRaw) notFound()
  const ruta = rutaRaw as unknown as RutaAcademia
  // Un borrador no existe para quien no lo gobierna.
  if (ruta.status !== 'live' && !esAdmin) notFound()

  const [{ data: videosRaw }, { data: avancesRaw }] = await Promise.all([
    admin
      .from('academy_videos')
      .select('id, title, description, storage_path, thumbnail_path, duration_seconds, chapters, interactions, tags, stack_id, status, created_by, created_at, updated_at'),
    admin
      .from('academy_video_progress')
      .select('video_id, last_position, seconds_watched, completed, updated_at')
      .eq('profile_id', user.id),
  ])

  // Se normalizan las interacciones ANTES de derivar el arbol: el recorrido
  // lee `opts[].go` y con la forma cruda de la base podria no encontrarlo.
  const videos = ((videosRaw ?? []) as unknown as VideoAcademia[]).map((v) => ({
    ...v,
    interactions: validarInteracciones(v.interactions) ?? [],
  }))
  const avances = (avancesRaw ?? []) as unknown as AvanceVideo[]

  const resumen = construirArbol(ruta.entry_video_id, videos, avances)
  const siguiente = siguientePaso(resumen)

  return (
    <VistaRuta
      workspaceSlug={params.workspaceSlug}
      ruta={ruta}
      resumen={resumen}
      siguienteId={siguiente?.videoId ?? null}
      esAdmin={esAdmin}
    />
  )
}

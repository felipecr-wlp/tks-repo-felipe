/**
 * Diagrama de flujo de la Academia (solo admin). Carga el catalogo con sus
 * interacciones normalizadas: el diagrama deriva las flechas de ahi, asi que
 * si llegaran crudas de la base, las opciones ramificadas no se dibujarian.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { isOrgAdmin } from '@/lib/team-access'
import { validarInteracciones, type VideoAcademia } from '@/lib/academy/videos'
import { DiagramaFlujo } from './DiagramaFlujo'

interface PageProps {
  params: { workspaceSlug: string }
}

export default async function DiagramaPage({ params }: PageProps) {
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

  // 404 y no 403: para quien no gobierna la academia, esta pantalla no existe.
  if (!(await isOrgAdmin(user.id))) notFound()

  const [{ data: vids }, { data: viewers }] = await Promise.all([
    admin
      .from('academy_videos')
      .select('id, title, description, storage_path, thumbnail_path, duration_seconds, chapters, interactions, tags, stack_id, status, audience, audience_profiles, diagram_x, diagram_y, requires_ack, requires_verification, valid_months, ack_text, created_by, created_at, updated_at')
      .order('created_at', { ascending: false }),
    admin.from('academy_video_viewers').select('video_id'),
  ])

  const videos = ((vids ?? []) as unknown as VideoAcademia[]).map((v) => ({
    ...v,
    interactions: validarInteracciones(v.interactions) ?? [],
  }))

  const nombradasPorVideo: Record<string, number> = {}
  for (const r of viewers ?? []) {
    nombradasPorVideo[r.video_id] = (nombradasPorVideo[r.video_id] ?? 0) + 1
  }

  return (
    <DiagramaFlujo
      workspaceSlug={params.workspaceSlug}
      videos={videos}
      nombradasPorVideo={nombradasPorVideo}
    />
  )
}

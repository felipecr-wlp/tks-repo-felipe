/**
 * Panel de configuracion de la Academia (solo admin): escuelas, stacks, rutas
 * y videos en una sola pantalla, en vez de repartidos entre el modal de
 * subida y la consola.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { isOrgAdmin } from '@/lib/team-access'
import type {
  EscuelaAcademia, RutaAcademia, StackAcademia, VideoAcademia,
} from '@/lib/academy/videos'
import { PanelAcademia } from './PanelAcademia'

interface PageProps {
  params: { workspaceSlug: string }
}

export default async function PanelPage({ params }: PageProps) {
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

  // 404 y no 403 a proposito: para quien no gobierna la academia, este panel
  // no existe. Un 403 confirmaria que hay algo aqui.
  if (!(await isOrgAdmin(user.id))) notFound()

  const [{ data: esc }, { data: st }, { data: ru }, { data: vi }, { data: viewers }] = await Promise.all([
    admin.from('academy_schools')
      .select('id, code, title, description, accent, mandatory, position, created_at, updated_at')
      .order('position'),
    admin.from('academy_stacks')
      .select('id, title, description, accent, position, school_id, created_by, created_at, updated_at')
      .order('position'),
    admin.from('academy_paths')
      .select('id, title, description, school_id, entry_video_id, accent, position, status, audience, audience_profiles, created_by, created_at, updated_at')
      .order('position'),
    admin.from('academy_videos')
      .select('id, title, description, storage_path, thumbnail_path, duration_seconds, chapters, interactions, tags, stack_id, status, audience, audience_profiles, diagram_x, diagram_y, requires_ack, requires_verification, valid_months, ack_text, created_by, created_at, updated_at')
      .order('created_at', { ascending: false }),
    admin.from('academy_video_viewers').select('video_id'),
  ])

  const nombradasPorVideo: Record<string, number> = {}
  for (const r of viewers ?? []) {
    nombradasPorVideo[r.video_id] = (nombradasPorVideo[r.video_id] ?? 0) + 1
  }

  return (
    <PanelAcademia
      workspaceSlug={params.workspaceSlug}
      escuelas={(esc ?? []) as unknown as EscuelaAcademia[]}
      stacks={(st ?? []) as unknown as StackAcademia[]}
      rutas={(ru ?? []) as unknown as RutaAcademia[]}
      videos={(vi ?? []) as unknown as VideoAcademia[]}
      nombradasPorVideo={nombradasPorVideo}
    />
  )
}

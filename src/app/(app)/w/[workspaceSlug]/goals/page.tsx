/**
 * Pagina de Metas (OKR) del workspace. Vista de objetivos con progreso agregado.
 *
 * El server valida sesion + membresia (anti-IDOR por slug) y resuelve el
 * workspaceId + la lista de miembros (para elegir responsable). El detalle
 * (crear, editar, enlazar tareas) lo maneja el cliente contra /api/goals.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { GoalsView } from '@/components/goals/GoalsView'

interface GoalsPageProps {
  params: { workspaceSlug: string }
}

export default async function GoalsPage({ params }: GoalsPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // Workspace desde membership (anti-RLS-loop / anti-IDOR).
  type WsFromMember = { workspaces: { id: string; name: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null; error: unknown }

  const workspace = row?.workspaces
  if (!workspace) redirect('/')

  // Miembros del workspace (para el selector de responsable).
  type MemberRow = { profiles: { id: string; display_name: string | null; avatar_url: string | null } | null }
  const { data: memberRows } = await admin
    .from('workspace_members')
    .select('profiles ( id, display_name, avatar_url )')
    .eq('workspace_id', workspace.id) as { data: MemberRow[] | null }

  const members = (memberRows ?? [])
    .map(m => m.profiles)
    .filter((p): p is { id: string; display_name: string | null; avatar_url: string | null } => Boolean(p))

  return (
    <GoalsView
      workspaceId={workspace.id}
      workspaceName={workspace.name}
      members={members}
    />
  )
}

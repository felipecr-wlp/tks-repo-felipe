/**
 * Configuración → Sala de espera (Lobby).
 * Lista los usuarios de la organización que aún no tienen acceso a ningún
 * workspace y permite ubicarlos en este workspace, departamento y equipo.
 */
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { LobbyPanel } from './LobbyPanel'

export default async function LobbySettingsPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')
  if (!ctx.isAdmin) redirect(`/w/${params.workspaceSlug}`)

  const admin = createAdminClient()

  // Perfiles de la org sin acceso a ningún workspace = en sala de espera.
  type Prof = {
    id: string
    display_name: string | null
    email: string | null
    avatar_url: string | null
    created_at: string
  }
  const { data: profiles } = (await admin
    .from('profiles')
    .select('id, display_name, email, avatar_url, created_at')
    .eq('org_id', ctx.workspace.org_id)
    .order('created_at', { ascending: true })) as { data: Prof[] | null; error: unknown }

  const ids = (profiles ?? []).map((p) => p.id)
  let placed = new Set<string>()
  if (ids.length > 0) {
    const { data: memberRows } = (await admin
      .from('workspace_members')
      .select('profile_id')
      .in('profile_id', ids)) as { data: { profile_id: string }[] | null; error: unknown }
    placed = new Set((memberRows ?? []).map((r) => r.profile_id))
  }

  const waiting = (profiles ?? [])
    .filter((p) => !placed.has(p.id))
    .map((p) => ({
      profile_id: p.id,
      display_name: p.display_name ?? 'Usuario',
      email: p.email ?? '',
      avatar_url: p.avatar_url ?? null,
      created_at: p.created_at,
    }))

  // Departamentos y equipos del workspace para los selectores de ubicación.
  type DeptRow = { id: string; name: string; is_restricted: boolean }
  const { data: departments } = (await admin
    .from('spaces')
    .select('id, name, is_restricted')
    .eq('workspace_id', ctx.workspace.id)
    .eq('is_archived', false)
    .order('name', { ascending: true })) as { data: DeptRow[] | null; error: unknown }

  type TeamRow = { id: string; name: string; space_id: string | null }
  const { data: teams } = (await admin
    .from('teams')
    .select('id, name, space_id')
    .eq('workspace_id', ctx.workspace.id)
    .eq('is_archived', false)
    .order('name', { ascending: true })) as { data: TeamRow[] | null; error: unknown }

  return (
    <LobbyPanel
      workspaceId={ctx.workspace.id}
      workspaceName={ctx.workspace.name}
      initialWaiting={waiting}
      departments={departments ?? []}
      teams={teams ?? []}
    />
  )
}

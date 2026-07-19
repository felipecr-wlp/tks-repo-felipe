/**
 * Configuración → Departamentos. Visualiza y organiza los departamentos (spaces) del workspace.
 */
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { DepartmentsPanel } from './DepartmentsPanel'

interface SpaceRow {
  id: string
  name: string
  description: string | null
  is_restricted: boolean
  is_archived: boolean
}

export default async function DepartmentsSettingsPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')
  if (!ctx.isAdmin) redirect(`/w/${params.workspaceSlug}`)

  const admin = createAdminClient()

  const { data: spaces } = (await admin
    .from('spaces')
    .select('id, name, description, is_restricted, is_archived')
    .eq('workspace_id', ctx.workspace.id)
    .order('name', { ascending: true })) as { data: SpaceRow[] | null; error: unknown }

  const { data: memberRows } = (await admin
    .from('space_members')
    .select('space_id')) as { data: { space_id: string }[] | null; error: unknown }

  const counts = new Map<string, number>()
  for (const r of memberRows ?? []) counts.set(r.space_id, (counts.get(r.space_id) ?? 0) + 1)

  const initialSpaces = (spaces ?? []).map((s) => ({
    ...s,
    member_count: counts.get(s.id) ?? 0,
  }))

  // Miembros del workspace (para el selector de asignación por departamento)
  type WsMemberRow = {
    profile_id: string
    profiles: { id: string; display_name: string | null; email: string | null; avatar_url: string | null } | null
  }
  const { data: wsMembers } = (await admin
    .from('workspace_members')
    .select('profile_id, profiles ( id, display_name, email, avatar_url )')
    .eq('workspace_id', ctx.workspace.id)) as { data: WsMemberRow[] | null; error: unknown }

  const workspaceMembers = (wsMembers ?? [])
    .map((m) => ({
      profile_id: m.profile_id,
      display_name: m.profiles?.display_name ?? 'Usuario',
      email: m.profiles?.email ?? '',
      avatar_url: m.profiles?.avatar_url ?? null,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))

  return (
    <DepartmentsPanel
      workspaceId={ctx.workspace.id}
      initialSpaces={initialSpaces}
      workspaceMembers={workspaceMembers}
    />
  )
}

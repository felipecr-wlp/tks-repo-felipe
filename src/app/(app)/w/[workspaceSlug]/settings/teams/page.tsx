/**
 * Configuración → Equipos. Visualiza y organiza los equipos del workspace.
 */
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { TeamsPanel } from './TeamsPanel'

interface TeamRow {
  id: string
  name: string
  slug: string
  description: string | null
  methodology: string
}

export default async function TeamsSettingsPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')
  if (!ctx.isAdmin) redirect(`/w/${params.workspaceSlug}`)

  const admin = createAdminClient()

  const { data: teams } = (await admin
    .from('teams')
    .select('id, name, slug, description, methodology')
    .eq('workspace_id', ctx.workspace.id)
    .order('name', { ascending: true })) as { data: TeamRow[] | null; error: unknown }

  const { data: memberRows } = (await admin
    .from('team_members')
    .select('team_id')) as { data: { team_id: string }[] | null; error: unknown }

  const counts = new Map<string, number>()
  for (const r of memberRows ?? []) counts.set(r.team_id, (counts.get(r.team_id) ?? 0) + 1)

  const initialTeams = (teams ?? []).map((t) => ({
    ...t,
    member_count: counts.get(t.id) ?? 0,
  }))

  return (
    <TeamsPanel workspaceSlug={params.workspaceSlug} initialTeams={initialTeams} />
  )
}

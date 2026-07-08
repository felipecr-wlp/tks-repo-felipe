/**
 * Crear nuevo proyecto en un equipo.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { NewProjectForm } from './NewProjectForm'

interface NewProjectPageProps {
  params: { workspaceSlug: string; teamSlug: string }
}

export const metadata = { title: 'Nuevo proyecto · WLO' }

export default async function NewProjectPage({ params }: NewProjectPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // Workspace desde membership (anti-RLS-loop)
  type WsFromMember = { workspaces: { id: string; name: string } | null }
  const { data: wsRow } = await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null; error: unknown }

  const workspace = wsRow?.workspaces
  if (!workspace) redirect('/')

  // Team desde membership
  type TeamFromMember = {
    role: string
    teams: { id: string; name: string } | null
  }
  const { data: teamRow } = await admin
    .from('team_members')
    .select(`
      role,
      teams!inner ( id, name, workspace_id )
    `)
    .eq('profile_id', user.id)
    .eq('teams.slug', params.teamSlug)
    .eq('teams.workspace_id', workspace.id)
    .limit(1)
    .maybeSingle() as { data: TeamFromMember | null; error: unknown }

  const team = teamRow?.teams
  if (!team) notFound()

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-6 pt-16">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <p className="text-xs text-muted-foreground mb-1">
            {workspace.name} / {team.name}
          </p>
          <h1 className="text-2xl font-semibold text-foreground">Nuevo proyecto</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Los proyectos contienen tareas, notas y archivos del equipo.
          </p>
        </div>
        <NewProjectForm
          teamId={team.id}
          workspaceSlug={params.workspaceSlug}
          teamSlug={params.teamSlug}
        />
      </div>
    </div>
  )
}

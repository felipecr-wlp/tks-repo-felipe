/**
 * Crear nuevo equipo en el workspace.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { redirect } from 'next/navigation'
import { NewTeamForm } from './NewTeamForm'

interface NewTeamPageProps {
  params: { workspaceSlug: string }
}

export const metadata = { title: 'Nuevo equipo · WLO' }

export default async function NewTeamPage({ params }: NewTeamPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // Workspace + membership desde la membership del user (anti-RLS)
  type WsFromMember = {
    role: string
    workspaces: { id: string; name: string } | null
  }
  const { data: row } = await admin
    .from('workspace_members')
    .select(`
      role,
      workspaces!inner ( id, name )
    `)
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null; error: unknown }

  const workspace = row?.workspaces
  if (!workspace) redirect('/')

  // Solo los administradores del workspace pueden crear equipos.
  const adminCtx = await isWorkspaceAdminById(workspace.id)
  if (!adminCtx?.isAdmin) redirect(`/w/${params.workspaceSlug}`)

  // Departamentos activos del workspace, para colocar el equipo dentro de uno.
  type DeptRow = { id: string; name: string; icon: string | null; is_restricted: boolean }
  const { data: departments } = await admin
    .from('spaces')
    .select('id, name, icon, is_restricted')
    .eq('workspace_id', workspace.id)
    .eq('is_archived', false)
    .order('name', { ascending: true }) as { data: DeptRow[] | null; error: unknown }

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-6 pt-16">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <p className="text-xs text-muted-foreground mb-1">{workspace.name}</p>
          <h1 className="text-2xl font-semibold text-foreground">Nuevo equipo</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Los equipos agrupan proyectos y miembros con objetivos comunes.
          </p>
        </div>
        <NewTeamForm
          workspaceId={workspace.id}
          workspaceSlug={params.workspaceSlug}
          departments={departments ?? []}
        />
      </div>
    </div>
  )
}

/**
 * Crear un nuevo workspace adicional para la organización.
 */
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { NewWorkspaceForm } from './NewWorkspaceForm'

export const metadata = { title: 'Nuevo workspace · WLO' }

export default async function NewWorkspacePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Obtener org del usuario
  type ProfileRow = { org_id: string | null; display_name: string }
  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id, display_name')
    .eq('id', user.id)
    .single() as { data: ProfileRow | null; error: unknown }

  if (!profile?.org_id) redirect('/onboarding')

  // Solo admins de la org pueden crear workspaces
  type OrgMemberRow = { role: string }
  const { data: orgMembership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', profile.org_id)
    .eq('profile_id', user.id)
    .single() as { data: OrgMemberRow | null; error: unknown }

  if (!orgMembership || orgMembership.role !== 'admin') {
    redirect('/')
  }

  type OrgRow = { name: string }
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', profile.org_id)
    .single() as { data: OrgRow | null; error: unknown }

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-6 pt-16">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <p className="text-xs text-muted-foreground mb-1">{org?.name}</p>
          <h1 className="text-2xl font-semibold text-foreground">Nuevo workspace</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Crea un espacio de trabajo adicional para otro equipo o área.
          </p>
        </div>
        <NewWorkspaceForm orgId={profile.org_id} />
      </div>
    </div>
  )
}

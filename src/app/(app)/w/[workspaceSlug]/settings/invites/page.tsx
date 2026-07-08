/**
 * Settings → Invites del workspace.
 * Solo accesible para admins del workspace u org owners/admins.
 */
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { InvitesPanel } from './InvitesPanel'

interface InvitesSettingsPageProps {
  params: { workspaceSlug: string }
}

export const metadata = { title: 'Invitaciones · WLO' }

export default async function InvitesSettingsPage({ params }: InvitesSettingsPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Cargar workspace
  type WsRow = { id: string; name: string; slug: string }
  const { data: workspace } = await supabase
    .from('workspaces')
    .select('id, name, slug')
    .eq('slug', params.workspaceSlug)
    .single() as { data: WsRow | null; error: unknown }

  if (!workspace) notFound()

  // Verificar admin
  type ProfileRow = { org_role: string | null }
  const { data: profile } = await supabase
    .from('profiles')
    .select('org_role')
    .eq('id', user.id)
    .single() as { data: ProfileRow | null; error: unknown }

  type MembershipRow = { role: string }
  const { data: membership } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace.id)
    .eq('profile_id', user.id)
    .single() as { data: MembershipRow | null; error: unknown }

  const isAdmin =
    profile?.org_role === 'owner' ||
    profile?.org_role === 'admin' ||
    membership?.role === 'admin'

  if (!isAdmin) redirect(`/w/${params.workspaceSlug}`)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-foreground">Invitaciones</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Genera códigos para que otros se unan a {workspace.name}.
        </p>
      </div>

      <InvitesPanel workspaceId={workspace.id} workspaceSlug={workspace.slug} />
    </div>
  )
}

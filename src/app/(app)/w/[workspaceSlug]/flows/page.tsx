import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'

interface Props { params: { workspaceSlug: string } }

export default async function FlowsPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()
  type Ws = { workspaces: { id: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner(id)')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .maybeSingle() as { data: Ws | null; error: unknown }

  if (!row?.workspaces) redirect('/')

  const { data: plugin } = await admin
    .from('connector_installs')
    .select('id')
    .eq('workspace_id', row.workspaces.id)
    .eq('app_id', 'wlo-flows')
    .eq('enabled', true)
    .maybeSingle() as { data: { id: string } | null; error: unknown }

  if (!plugin) redirect(`/w/${params.workspaceSlug}`)
  redirect(`/w/${params.workspaceSlug}/p/wlo-flows`)
}

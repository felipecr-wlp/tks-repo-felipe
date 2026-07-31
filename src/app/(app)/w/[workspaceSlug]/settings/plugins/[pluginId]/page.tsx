import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PluginDetail } from './PluginDetail'
import type { PluginManifest } from '@/lib/widgets/registry'

interface Props { params: { workspaceSlug: string; pluginId: string } }

export default async function PluginDetailPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  type WsRow = { workspaces: { id: string; slug: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('role, workspaces!inner(id, slug)')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .maybeSingle() as { data: (WsRow & { role: string }) | null; error: unknown }

  if (!row?.workspaces) redirect('/')
  const isAdmin = row.role === 'admin'

  // Plugin install data
  const { data: install } = await admin
    .from('connector_installs')
    .select('id, app_id, manifest, enabled, installed_at, updated_at')
    .eq('id', params.pluginId)
    .eq('workspace_id', row.workspaces.id)
    .maybeSingle() as { data: any; error: unknown }

  if (!install) redirect(`/w/${params.workspaceSlug}/settings/plugins`)

  // Plugin catalog info
  const { data: catalog } = await admin
    .from('connector_apps')
    .select('id, name, icon')
    .eq('id', install.app_id)
    .maybeSingle() as { data: { id: string; name: string; icon: string } | null; error: unknown }

  // Stats: how many workspaces have this plugin
  const { count: totalInstalls } = await admin
    .from('connector_installs')
    .select('*', { count: 'exact', head: true })
    .eq('app_id', install.app_id)

  // Flow-specific stats
  let flowCount = 0
  if (install.app_id === 'wlo-flows') {
    const { count } = await admin
      .from('flows')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', row.workspaces.id)
    flowCount = count ?? 0
  }

  return (
    <div className="space-y-6">
      <PluginDetail
        pluginId={install.id}
        workspaceSlug={params.workspaceSlug}
        install={install}
        catalog={catalog}
        isAdmin={isAdmin}
        stats={{ totalInstalls: totalInstalls ?? 0, flowCount }}
      />
    </div>
  )
}

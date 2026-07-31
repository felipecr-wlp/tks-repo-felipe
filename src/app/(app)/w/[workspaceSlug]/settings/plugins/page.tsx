import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PluginManager } from './PluginManager'
import { scanPlugins } from '@/lib/plugin-registry'

interface Props { params: { workspaceSlug: string } }

export default async function PluginsPage({ params }: Props) {
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
  const wsId = row.workspaces.id
  const isAdmin = row.role === 'admin'

  // Catalog from filesystem (plugins/ directory) + DB-only apps
  const fsPlugins = scanPlugins()
  const fsIds = new Set(fsPlugins.map(p => p.id))
  const catalog = fsPlugins.map(p => ({ id: p.id, name: p.name, icon: p.icon }))

  // Include DB-only installed plugins
  const { data: installed } = await admin
    .from('connector_installs')
    .select('id, app_id, plugin_type, enabled')
    .eq('workspace_id', wsId)
    .eq('plugin_type', 'widget') as { data: Array<{ id: string; app_id: string; plugin_type: string; enabled: boolean }> | null; error: unknown }

  // Add DB-only apps to catalog
  const installedIds = new Set((installed ?? []).map(i => i.app_id))
  const allCatalogIds = new Set(catalog.map(c => c.id))
  for (const appId of installedIds) {
    if (!allCatalogIds.has(appId)) {
      const { data: app } = await admin
        .from('connector_apps')
        .select('id, name, icon')
        .eq('id', appId)
        .maybeSingle() as { data: { id: string; name: string; icon: string } | null; error: unknown }
      if (app) catalog.push({ id: app.id, name: app.name, icon: app.icon })
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Plugins & Widgets</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Activa o desactiva complementos para este espacio de trabajo.
        </p>
      </div>
      <PluginManager
        workspaceId={wsId}
        workspaceSlug={params.workspaceSlug}
        catalog={catalog ?? []}
        installed={installed ?? []}
        isAdmin={isAdmin}
      />
    </div>
  )
}

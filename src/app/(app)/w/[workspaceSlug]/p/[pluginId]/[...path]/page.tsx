import { notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getPlugin } from '@/lib/plugin-registry'
import * as path from 'path'
import * as fs from 'fs'

interface Props {
  params: { workspaceSlug: string; pluginId: string; path: string[] }
}

export default async function PluginPage({ params }: Props) {
  // Verify workspace access
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const admin = createAdminClient()
  type WsRow = { workspaces: { id: string; name: string; slug: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner(id, name, slug)')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .maybeSingle() as { data: WsRow | null; error: unknown }

  if (!row?.workspaces) notFound()

  // Check plugin is installed
  const { data: install } = await admin
    .from('connector_installs')
    .select('id, enabled')
    .eq('workspace_id', row.workspaces.id)
    .eq('app_id', params.pluginId)
    .eq('enabled', true)
    .maybeSingle() as { data: { id: string; enabled: boolean } | null; error: unknown }

  if (!install) notFound()

  // Load plugin manifest
  const manifest = getPlugin(params.pluginId)
  if (!manifest) notFound()

  // Try to load plugin page component
  const pluginDir = path.join(process.cwd(), 'plugins', params.pluginId)
  const pageFile = path.join(pluginDir, 'page.js')

  if (!fs.existsSync(pageFile)) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-8">
        <p className="text-lg font-semibold">{manifest.name}</p>
        <p className="text-sm">{manifest.description}</p>
        <p className="text-xs">v{manifest.version} — {manifest.author}</p>
      </div>
    )
  }

  // Load and render plugin page
  try {
    // Clear require cache for hot-reload support
    delete require.cache[require.resolve(pageFile)]
    const PluginComponent = require(pageFile).default
    if (!PluginComponent) {
      return <div className="p-8 text-muted-foreground">Plugin sin componente exportado</div>
    }
    return <PluginComponent workspaceId={row.workspaces.id} workspaceSlug={params.workspaceSlug} />
  } catch (e: any) {
    return (
      <div className="p-8">
        <p className="text-destructive font-medium">Error al cargar plugin</p>
        <p className="text-xs text-muted-foreground mt-1">{e.message}</p>
      </div>
    )
  }
}

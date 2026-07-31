import { notFound } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getPlugin } from '@/lib/plugin-registry'
import { Workflow } from 'lucide-react'

interface Props {
  params: { workspaceSlug: string; pluginId: string; path: string[] }
}

export default async function PluginPage({ params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) notFound()

  const admin = createAdminClient()
  type WsRow = { workspaces: { id: string; slug: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner(id, slug)')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .maybeSingle() as { data: WsRow | null; error: unknown }

  if (!row?.workspaces) notFound()

  const { data: install } = await admin
    .from('connector_installs')
    .select('id, enabled')
    .eq('workspace_id', row.workspaces.id)
    .eq('app_id', params.pluginId)
    .eq('enabled', true)
    .maybeSingle() as { data: { id: string; enabled: boolean } | null; error: unknown }
  if (!install) notFound()

  const manifest = getPlugin(params.pluginId)

  // Generic plugin: load via iframe from connector_apps.base_url
  const { data: app } = await admin
    .from('connector_apps')
    .select('base_url, name')
    .eq('id', params.pluginId)
    .maybeSingle() as { data: { base_url: string; name: string } | null; error: unknown }

  if (app?.base_url) {
    const subPath = params.path?.join('/') || ''
    return (
      <div className="h-full w-full">
        <iframe src={`${app.base_url}?workspace_id=${row.workspaces.id}&workspace_slug=${params.workspaceSlug}&path=${encodeURIComponent(subPath)}`}
          className="w-full h-full border-0" sandbox="allow-scripts allow-same-origin allow-forms" title={app.name || params.pluginId} />
      </div>
    )
  }

  // Fallback: show plugin info
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-8">
      <Workflow className="w-12 h-12 opacity-20" />
      <p className="text-lg font-semibold">{manifest?.name || params.pluginId}</p>
      <p className="text-sm text-center max-w-md">{manifest?.description || 'Plugin instalado en este workspace.'}</p>
      {manifest && <p className="text-xs">v{manifest.version} — {manifest.author}</p>}
      <div className="flex gap-3 mt-4">
        <a href={`/w/${params.workspaceSlug}/settings/plugins`} className="text-xs text-primary hover:underline">Configurar plugins</a>
      </div>
    </div>
  )
}

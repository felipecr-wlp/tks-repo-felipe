import { notFound, redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getPlugin } from '@/lib/plugin-registry'

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

  // wlo-flows: redirect to native route
  if (params.pluginId === 'wlo-flows') {
    const subPath = params.path?.join('/') || ''
    const target = subPath ? `/w/${params.workspaceSlug}/flows/${subPath}` : `/w/${params.workspaceSlug}/flows`
    return redirect(target)
  }

  // Generic plugin: load via iframe from connector_apps.base_url
  const { data: app } = await admin
    .from('connector_apps')
    .select('base_url, name')
    .eq('id', params.pluginId)
    .maybeSingle() as { data: { base_url: string; name: string } | null; error: unknown }

  if (app?.base_url) {
    const subPath = params.path?.join('/') || ''
    const pluginUrl = `${app.base_url}?workspace_id=${row.workspaces.id}&workspace_slug=${params.workspaceSlug}&path=${encodeURIComponent(subPath)}`
    return (
      <div className="h-full w-full">
        <iframe
          src={pluginUrl}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms"
          title={app.name || params.pluginId}
        />
      </div>
    )
  }

  // Fallback: show plugin info
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-8">
      <p className="text-lg font-semibold">{manifest?.name || params.pluginId}</p>
      <p className="text-sm">{manifest?.description || 'Plugin instalado'}</p>
      <p className="text-xs text-muted-foreground mt-4">Este plugin no tiene URL de despliegue configurada.</p>
      <p className="text-xs text-muted-foreground">Configura base_url en connector_apps para cargarlo via iframe.</p>
    </div>
  )
}

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

  // Flows: render native list
  if (params.pluginId === 'wlo-flows') {
    const subPath = params.path?.join('/') || ''
    if (subPath) {
      return redirect(`/w/${params.workspaceSlug}/flows/${subPath}`)
    }
    const { FlowsList } = await import('../../flows/FlowsList')
    return <FlowsList workspaceSlug={params.workspaceSlug} workspaceId={row.workspaces.id} />
  }

  // Generic: show plugin info
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-8">
      <p className="text-lg font-semibold">{manifest?.name || params.pluginId}</p>
      <p className="text-sm">{manifest?.description || 'Plugin instalado'}</p>
      {manifest && <p className="text-xs">v{manifest.version} — {manifest.author}</p>}
    </div>
  )
}

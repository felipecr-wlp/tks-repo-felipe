import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { scanPlugins, type PluginManifest } from '@/lib/plugin-registry'

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const url = new URL(request.url)
  const workspaceId = url.searchParams.get('workspace_id')

  // Scan filesystem for installed plugins
  const fsPlugins = scanPlugins()
  const fsMap = new Map(fsPlugins.map(p => [p.id, p]))

  // Get installed status from DB if workspaceId provided
  const installedMap = new Map<string, { id: string; enabled: boolean }>()
  if (workspaceId) {
    const admin = createAdminClient()
    const { data: installed } = await admin
      .from('connector_installs')
      .select('id, app_id, enabled')
      .eq('workspace_id', workspaceId)
      .eq('plugin_type', 'widget') as any
    if (installed) {
      for (const i of installed) installedMap.set(i.app_id, { id: i.id, enabled: i.enabled })
    }
  }

  // Merge: filesystem plugins + DB-only plugins (uploaded but no filesystem entry)
  const catalog: Array<PluginManifest & { installed?: boolean; installId?: string }> = []

  for (const p of fsPlugins) {
    const inst = installedMap.get(p.id)
    catalog.push({ ...p, installed: !!inst, installId: inst?.id })
  }

  // Also include DB-only plugins (registered but no filesystem manifest)
  for (const [appId, inst] of installedMap) {
    if (!fsMap.has(appId)) {
      catalog.push({
        id: appId, name: appId, version: '0.0.0', type: 'widget',
        icon: 'puzzle', description: '', author: '', wlo_version: '>=1.0.0', slots: [],
        installed: true, installId: inst.id,
      })
    }
  }

  return NextResponse.json({ catalog })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const workspace_id = url.searchParams.get('workspace_id')
  const slot = url.searchParams.get('slot')

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const query = admin
    .from('connector_installs')
    .select('id, app_id, plugin_type, manifest, enabled')
    .eq('workspace_id', workspace_id || '')
    .eq('plugin_type', 'widget')

  const { data: installs, error } = await query as { data: any[] | null; error: unknown }
  if (error) {
    console.error('[widgets GET]', error)
    return NextResponse.json({ error: 'Error al cargar widgets' }, { status: 500 })
  }

  // Get widget catalog entries for installed widgets
  const installedAppIds = [...new Set((installs ?? []).map((i: any) => i.app_id))]
  let widgetMap: Record<string, any> = {}
  if (installedAppIds.length > 0) {
    const { data: catalog } = await admin
      .from('widget_catalog')
      .select('id, name, description, icon, slot, component')
      .in('id', installedAppIds) as { data: any[] | null; error: unknown }
    if (catalog) {
      for (const w of catalog) widgetMap[w.id] = w
    }
  }

  const widgets = (installs ?? []).map((i: any) => ({
    ...i,
    widget: widgetMap[i.app_id] || null,
  })).filter((w: any) => slot ? !w.widget || w.widget.slot === slot : true)

  return NextResponse.json({ widgets })
}

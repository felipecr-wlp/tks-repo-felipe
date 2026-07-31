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
    .select('id, app_id, plugin_type, manifest, enabled, widget:widget_catalog!inner(id, name, description, icon, slot, component)')
    .eq('workspace_id', workspace_id || '')
    .eq('plugin_type', 'widget')

  if (slot) query.eq('widget.slot', slot)

  const { data: installs, error } = await query as { data: any[] | null; error: unknown }
  if (error) {
    console.error('[widgets GET]', error)
    return NextResponse.json({ error: 'Error al cargar widgets' }, { status: 500 })
  }

  return NextResponse.json({ widgets: installs ?? [] })
}

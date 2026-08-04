import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: { url: string; workspace_id: string }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }
  if (!body.url || !body.workspace_id) return NextResponse.json({ error: 'Faltan url o workspace_id' }, { status: 400 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', body.workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admins pueden instalar' }, { status: 403 })
  }

  // Fetch manifest from URL
  let manifestUrl = body.url
  if (!manifestUrl.endsWith('/manifest.json')) {
    manifestUrl = manifestUrl.replace(/\/$/, '') + '/manifest.json'
  }

  let manifest: any
  try {
    const res = await fetch(manifestUrl)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    manifest = await res.json()
  } catch {
    return NextResponse.json({ error: 'No se pudo obtener el manifest de la URL' }, { status: 400 })
  }

  if (!manifest.id || !manifest.name) {
    return NextResponse.json({ error: 'Manifest invalido: falta id o name' }, { status: 400 })
  }

  const baseUrl = body.url.replace(/\/manifest\.json$/, '').replace(/\/$/, '')

  // Register app
  await (admin as any).from('connector_apps').upsert({
    id: manifest.id,
    name: manifest.name,
    icon: manifest.icon || 'puzzle',
    base_url: baseUrl,
  }, { onConflict: 'id' })

  // Install in workspace
  const { data: install, error } = await (admin as any)
    .from('connector_installs')
    .insert({
      workspace_id: body.workspace_id,
      app_id: manifest.id,
      plugin_type: manifest.type === 'widget' ? 'widget' : 'widget',
      manifest,
      enabled: true,
      installed_by: user.id,
    })
    .select('id')
    .single() as { data: { id: string } | null; error: unknown }

  if (error) {
    return NextResponse.json({ error: 'Error al instalar: ' + JSON.stringify(error) }, { status: 500 })
  }

  // Auto-register as widget if needed
  if (manifest.type === 'widget' && manifest.component) {
    await (admin as any).from('widget_catalog').upsert({
      id: manifest.id,
      name: manifest.name,
      description: manifest.description || '',
      icon: manifest.icon || 'puzzle',
      slot: manifest.slots?.[0] || 'dashboard',
      component: manifest.component,
    }, { onConflict: 'id' })
  }

  return NextResponse.json({ ok: true, pluginId: install?.id, manifest }, { status: 201 })
}

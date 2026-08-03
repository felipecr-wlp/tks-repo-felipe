import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import * as fs from 'fs'
import * as path from 'path'

interface RouteParams { params: { pluginId: string } }

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: install } = await admin
    .from('connector_installs')
    .select('id, app_id, workspace_id')
    .eq('id', params.pluginId)
    .maybeSingle() as { data: { id: string; app_id: string; workspace_id: string } | null; error: unknown }
  if (!install) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', install.workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admins pueden desinstalar' }, { status: 403 })
  }

  // Clean plugin-specific data before uninstalling
  if (install.app_id === 'wlo-flows') {
    // flow_shares has ON DELETE CASCADE, so deleting flows cleans everything
    await admin.from('flows').delete().eq('workspace_id', install.workspace_id)
  }

  // Delete from DB
  const { error } = await admin.from('connector_installs').delete().eq('id', params.pluginId)
  if (error) return NextResponse.json({ error: 'Error al desinstalar' }, { status: 500 })

  // Delete plugin directory
  const pluginDir = path.join(process.cwd(), 'plugins', install.app_id)
  if (fs.existsSync(pluginDir)) {
    try {
      fs.rmSync(pluginDir, { recursive: true, force: true })
      console.log(`[plugins] Deleted directory: ${pluginDir}`)
    } catch (e) {
      console.error(`[plugins] Failed to delete directory: ${pluginDir}`, e)
    }
  }

  return NextResponse.json({ ok: true })
}

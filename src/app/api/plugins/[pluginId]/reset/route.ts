import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

interface RouteParams { params: { pluginId: string } }

export async function POST(_request: NextRequest, { params }: RouteParams) {
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
    return NextResponse.json({ error: 'Solo admins' }, { status: 403 })
  }

  // Clean plugin-specific data
  if (install.app_id === 'wlo-flows') {
    await admin.from('flows').delete().eq('workspace_id', install.workspace_id)
  }

  return NextResponse.json({ ok: true })
}

/**
 * GET /api/connectors/log?workspace_id=xxx&limit=100, bitacora de llamadas.
 * Solo admin/owner del workspace. Para ver quien llamo a que y si fue rechazado.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const workspaceId = url.searchParams.get('workspace_id')
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id requerido' }, { status: 422 })
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500)

  const gate = await isWorkspaceAdminById(workspaceId)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('connector_call_log')
    .select('id, caller_app, target_app, action, scope, status, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  return NextResponse.json({ log: data ?? [] })
}

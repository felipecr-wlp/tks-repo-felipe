/**
 * DELETE /api/connectors/webhooks/<webhookId>, elimina una suscripcion.
 * Solo admin/owner del workspace dueno.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { isUuid } from '@/lib/validation'
import { applyRateLimit } from '@/lib/rate-limit'

export async function DELETE(
  request: NextRequest,
  { params }: { params: { webhookId: string } },
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  // El id va crudo a una columna uuid: sin esto, un id malformado no da 404 sino
  // que Postgres lanza 22P02 y sale un 500 opaco que cualquiera puede provocar.
  if (!isUuid(params.webhookId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const admin = createAdminClient()
  const { data: row } = (await admin
    .from('connector_webhooks')
    .select('id, workspace_id')
    .eq('id', params.webhookId)
    .maybeSingle()) as { data: { id: string; workspace_id: string } | null; error: unknown }

  if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const gate = await isWorkspaceAdminById(row.workspace_id)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const { error } = await admin.from('connector_webhooks').delete().eq('id', params.webhookId)
  if (error) return NextResponse.json({ error: 'No se pudo eliminar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/**
 * DELETE /api/connectors/keys/<keyId>, revoca una key (soft: setea revoked_at).
 * La key deja de funcionar al instante en el provider (el lookup exige revoked_at null).
 * Solo admin/owner del workspace dueno de la key.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { keyId: string } },
) {
  const admin = createAdminClient()

  const { data: key } = (await admin
    .from('connector_keys')
    .select('id, workspace_id, revoked_at')
    .eq('id', params.keyId)
    .maybeSingle()) as { data: { id: string; workspace_id: string } | null; error: unknown }

  if (!key) return NextResponse.json({ error: 'Key no encontrada' }, { status: 404 })

  const gate = await isWorkspaceAdminById(key.workspace_id)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const { error } = await admin
    .from('connector_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', params.keyId)

  if (error) return NextResponse.json({ error: 'No se pudo revocar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

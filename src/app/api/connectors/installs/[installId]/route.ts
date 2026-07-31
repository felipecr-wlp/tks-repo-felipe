/**
 * PATCH  /api/connectors/installs/<installId>, activa/desactiva o actualiza manifiesto
 * DELETE /api/connectors/installs/<installId>, desinstala
 * Solo admin/owner del workspace dueno del complemento.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/types'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  manifest: z.record(z.any()).optional(),
})

async function loadAndGate(installId: string) {
  const admin = createAdminClient()
  const { data: row } = (await admin
    .from('connector_installs')
    .select('id, workspace_id')
    .eq('id', installId)
    .maybeSingle()) as { data: { id: string; workspace_id: string } | null; error: unknown }
  if (!row) return { admin, row: null, gate: null }
  const gate = await isWorkspaceAdminById(row.workspace_id)
  return { admin, row, gate }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { installId: string } },
) {
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos invalidos' }, { status: 422 })

  const { admin, row, gate } = await loadAndGate(params.installId)
  if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const patch: { updated_at: string; enabled?: boolean; manifest?: Json } = {
    updated_at: new Date().toISOString(),
  }
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled
  if (parsed.data.manifest !== undefined) patch.manifest = parsed.data.manifest as Json

  const { error } = await admin.from('connector_installs').update(patch).eq('id', params.installId)
  if (error) return NextResponse.json({ error: 'No se pudo actualizar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { installId: string } },
) {
  const { admin, row, gate } = await loadAndGate(params.installId)
  if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const { error } = await admin.from('connector_installs').delete().eq('id', params.installId)
  if (error) return NextResponse.json({ error: 'No se pudo desinstalar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

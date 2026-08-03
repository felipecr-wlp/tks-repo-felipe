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
import { isUuid } from '@/lib/validation'
import { applyRateLimit } from '@/lib/rate-limit'
import { ALL_SCOPES } from '@/lib/connectors/scopes'

const patchSchema = z.object({
  enabled: z.boolean().optional(),
  manifest: z.record(z.any()).optional(),
  // Aceptar permisos NUEVOS que la herramienta empezo a pedir despues de estar
  // instalada. Es la misma decision que instalar, asi que pasa por el mismo
  // candado de admin y por la misma validacion contra lo que la app declaro.
  granted_scopes: z.array(z.string()).max(20).optional(),
})

async function loadAndGate(installId: string) {
  const admin = createAdminClient()
  const { data: row } = (await admin
    .from('connector_installs')
    .select('id, workspace_id, app_id')
    .eq('id', installId)
    .maybeSingle()) as { data: { id: string; workspace_id: string; app_id: string } | null; error: unknown }
  if (!row) return { admin, row: null, gate: null }
  const gate = await isWorkspaceAdminById(row.workspace_id)
  return { admin, row, gate }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { installId: string } },
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  // El id va crudo a una columna uuid: sin esto, un id malformado no da 404 sino
  // que Postgres lanza 22P02 y sale un 500 opaco que cualquiera puede provocar.
  if (!isUuid(params.installId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos invalidos' }, { status: 422 })

  const { admin, row, gate } = await loadAndGate(params.installId)
  if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const patch: { updated_at: string; enabled?: boolean; manifest?: Json; granted_scopes?: string[] } = {
    updated_at: new Date().toISOString(),
  }
  if (parsed.data.enabled !== undefined) patch.enabled = parsed.data.enabled
  if (parsed.data.manifest !== undefined) patch.manifest = parsed.data.manifest as Json

  if (parsed.data.granted_scopes !== undefined) {
    const { data: app } = (await admin
      .from('connector_apps')
      .select('requested_scopes')
      .eq('id', row.app_id)
      .maybeSingle()) as { data: { requested_scopes: string[] | null } | null; error: unknown }

    const pedidos = (app?.requested_scopes ?? []).filter((s) => ALL_SCOPES.includes(s))
    const deMas = parsed.data.granted_scopes.filter((s) => !pedidos.includes(s))
    if (deMas.length > 0) {
      return NextResponse.json({ error: `Esa herramienta no pidio: ${deMas.join(', ')}` }, { status: 422 })
    }
    patch.granted_scopes = parsed.data.granted_scopes
  }

  const { error } = await admin.from('connector_installs').update(patch).eq('id', params.installId)
  if (error) return NextResponse.json({ error: 'No se pudo actualizar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { installId: string } },
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  if (!isUuid(params.installId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const { admin, row, gate } = await loadAndGate(params.installId)
  if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const { error } = await admin.from('connector_installs').delete().eq('id', params.installId)
  if (error) return NextResponse.json({ error: 'No se pudo desinstalar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

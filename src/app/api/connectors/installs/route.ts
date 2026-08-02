/**
 * GET  /api/connectors/installs?workspace_id=xxx, complementos instalados
 * POST /api/connectors/installs, instala (o reactiva) un complemento con su manifiesto
 * Solo admin/owner del workspace.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { applyRateLimit } from '@/lib/rate-limit'

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  app_id: z.enum(['wli', 'wlo', 'wlm']),
  manifest: z.record(z.any()).default({}),
  enabled: z.boolean().default(true),
})

export async function GET(request: NextRequest) {
  const workspaceId = new URL(request.url).searchParams.get('workspace_id')
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id requerido' }, { status: 422 })

  const gate = await isWorkspaceAdminById(workspaceId)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('connector_installs')
    .select('id, app_id, manifest, enabled, installed_at, updated_at')
    .eq('workspace_id', workspaceId)
    .order('installed_at', { ascending: false })

  return NextResponse.json({ installs: data ?? [] })
}

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos', details: parsed.error.flatten() }, { status: 422 })
  }
  const { workspace_id, app_id, manifest, enabled } = parsed.data

  const gate = await isWorkspaceAdminById(workspace_id)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const admin = createAdminClient()
  const { data, error } = (await admin
    .from('connector_installs')
    .insert({
      workspace_id,
      app_id,
      manifest,
      enabled,
      installed_by: gate.userId,
    })
    .select('id, app_id, manifest, enabled, installed_at, updated_at')
    .single()) as { data: unknown; error: unknown }

  if (error || !data) return NextResponse.json({ error: 'No se pudo instalar' }, { status: 500 })
  return NextResponse.json({ install: data }, { status: 201 })
}

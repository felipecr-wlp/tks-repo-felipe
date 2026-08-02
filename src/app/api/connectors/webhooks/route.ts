/**
 * GET  /api/connectors/webhooks?workspace_id=xxx, suscripciones (sin el secreto)
 * POST /api/connectors/webhooks, crea una suscripcion y devuelve el secreto UNA vez
 * Solo admin/owner del workspace.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { newWebhookSecret } from '@/lib/connectors/keys'
import { applyRateLimit } from '@/lib/rate-limit'

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  source_app: z.enum(['wli', 'wlo', 'wlm']),
  event: z.string().min(1).max(120).trim(),
  target_url: z.string().url().max(500),
})

export async function GET(request: NextRequest) {
  const workspaceId = new URL(request.url).searchParams.get('workspace_id')
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id requerido' }, { status: 422 })

  const gate = await isWorkspaceAdminById(workspaceId)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('connector_webhooks')
    .select('id, source_app, event, target_url, enabled, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ webhooks: data ?? [] })
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
  const { workspace_id, source_app, event, target_url } = parsed.data

  const gate = await isWorkspaceAdminById(workspace_id)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const secret = newWebhookSecret()
  const admin = createAdminClient()
  const { data, error } = (await admin
    .from('connector_webhooks')
    .insert({
      workspace_id,
      source_app,
      event,
      target_url,
      secret,
      created_by: gate.userId,
    })
    .select('id, source_app, event, target_url, enabled, created_at')
    .single()) as { data: unknown; error: unknown }

  if (error || !data) return NextResponse.json({ error: 'No se pudo crear la suscripcion' }, { status: 500 })
  // El secreto va SOLO aqui, para configurar el emisor. No se vuelve a mostrar.
  return NextResponse.json({ webhook: data, secret }, { status: 201 })
}

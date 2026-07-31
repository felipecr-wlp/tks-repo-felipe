/**
 * GET  /api/connectors/keys?workspace_id=xxx, lista de keys (sin el token plano)
 * POST /api/connectors/keys, crea una key y devuelve el token EN CLARO una sola vez
 *
 * Solo admin/owner del workspace. El token nunca se vuelve a poder leer: se guarda
 * solo su hash. Copiar en el momento o crear otra.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { generateConnectorToken, hashToken, tokenPrefix } from '@/lib/connectors/keys'
import { isKnownScope, scopeDef } from '@/lib/connectors/scopes'

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  name: z.string().min(1).max(120).trim(),
  target_app: z.enum(['wli', 'wlo', 'wlm']),
  scopes: z.array(z.string()).max(50).default([]),
})

export async function GET(request: NextRequest) {
  const workspaceId = new URL(request.url).searchParams.get('workspace_id')
  if (!workspaceId) return NextResponse.json({ error: 'workspace_id requerido' }, { status: 422 })

  const gate = await isWorkspaceAdminById(workspaceId)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const admin = createAdminClient()
  const { data } = await admin
    .from('connector_keys')
    .select('id, name, target_app, token_prefix, scopes, created_at, last_used_at, revoked_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  return NextResponse.json({ keys: data ?? [] })
}

export async function POST(request: NextRequest) {
  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos', details: parsed.error.flatten() }, { status: 422 })
  }
  const { workspace_id, name, target_app, scopes } = parsed.data

  const gate = await isWorkspaceAdminById(workspace_id)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  // Solo scopes conocidos y que pertenezcan a la app destino.
  const cleanScopes = [...new Set(scopes)].filter(
    (s) => isKnownScope(s) && scopeDef(s)?.app === target_app,
  )

  const token = generateConnectorToken('live')
  const admin = createAdminClient()
  const { data, error } = (await admin
    .from('connector_keys')
    .insert({
      workspace_id,
      name,
      target_app,
      token_hash: hashToken(token),
      token_prefix: tokenPrefix(token),
      scopes: cleanScopes,
      created_by: gate.userId,
    })
    .select('id, name, target_app, token_prefix, scopes, created_at')
    .single()) as { data: { id: string } | null; error: unknown }

  if (error || !data) {
    return NextResponse.json({ error: 'No se pudo crear la key' }, { status: 500 })
  }

  // El token en claro va SOLO en esta respuesta. Nunca mas.
  return NextResponse.json({ key: data, token }, { status: 201 })
}

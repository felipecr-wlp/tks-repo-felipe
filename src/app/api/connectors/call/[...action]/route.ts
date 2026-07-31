/**
 * POST /api/connectors/call/<action>
 *
 * Endpoint proveedor del contrato de conectores. WLO expone aqui sus acciones para
 * que OTRAS apps (o sus propias automatizaciones) las invoquen con un token acotado.
 *
 * Auth: NO es de sesion. Es app a app con `Authorization: Bearer pck_live_...`.
 *   1. Hashea el token y busca la key viva en connector_keys.
 *   2. Si la accion exige scope, ese scope debe estar en key.scopes, si no 403.
 *   3. Valida el payload con el esquema de la accion y despacha al handler.
 *   4. Actualiza last_used_at y registra la llamada en connector_call_log.
 *
 * El registro de acciones vive en src/lib/connectors/actions.ts.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { hashToken } from '@/lib/connectors/keys'
import { getAction } from '@/lib/connectors/actions'

const TARGET_APP = 'wlo'

interface KeyRow {
  id: string
  workspace_id: string
  scopes: string[]
  revoked_at: string | null
}

export async function POST(
  request: NextRequest,
  { params }: { params: { action: string[] } },
) {
  const admin = createAdminClient()
  const actionPath = (params.action ?? []).join('/')

  // Datos para la bitacora, se completan conforme avanza.
  const callerApp = request.headers.get('x-pavific-app')
  let workspaceId: string | null = null
  let keyId: string | null = null
  let scopeUsed: string | null = null

  const log = (status: number) => {
    admin
      .from('connector_call_log')
      .insert({
        workspace_id: workspaceId,
        caller_app: callerApp,
        target_app: TARGET_APP,
        action: actionPath,
        scope: scopeUsed,
        status,
        key_id: keyId,
      })
      .then(() => {}, () => {}) // fire and forget, nunca romper la respuesta
  }

  // 1. Token
  const authz = request.headers.get('authorization') ?? ''
  const token = authz.toLowerCase().startsWith('bearer ') ? authz.slice(7).trim() : ''
  if (!token) {
    log(401)
    return NextResponse.json({ ok: false, error: 'Falta el token' }, { status: 401 })
  }

  const { data: key } = (await admin
    .from('connector_keys')
    .select('id, workspace_id, scopes, revoked_at')
    .eq('token_hash', hashToken(token))
    .is('revoked_at', null)
    .maybeSingle()) as { data: KeyRow | null; error: unknown }

  if (!key) {
    log(401)
    return NextResponse.json({ ok: false, error: 'Token invalido o revocado' }, { status: 401 })
  }
  workspaceId = key.workspace_id
  keyId = key.id

  // 2. Accion + scope
  const action = getAction(actionPath)
  if (!action) {
    log(404)
    return NextResponse.json({ ok: false, error: `Accion desconocida: ${actionPath}` }, { status: 404 })
  }
  if (action.scope) {
    scopeUsed = action.scope
    if (!key.scopes.includes(action.scope)) {
      log(403)
      return NextResponse.json(
        { ok: false, error: `La key no tiene el scope requerido: ${action.scope}` },
        { status: 403 },
      )
    }
  }

  // 3. Payload
  let body: unknown = {}
  try {
    const text = await request.text()
    body = text ? JSON.parse(text) : {}
  } catch {
    log(400)
    return NextResponse.json({ ok: false, error: 'JSON invalido' }, { status: 400 })
  }
  const parsed = action.schema.safeParse(body)
  if (!parsed.success) {
    log(422)
    return NextResponse.json(
      { ok: false, error: 'Payload invalido', details: parsed.error.flatten() },
      { status: 422 },
    )
  }

  // 4. Ejecutar
  try {
    const data = await action.handler(parsed.data, { admin, workspaceId, callerApp })
    admin
      .from('connector_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', key.id)
      .then(() => {}, () => {})
    log(200)
    return NextResponse.json({ ok: true, data })
  } catch (err) {
    log(500)
    const message = err instanceof Error ? err.message : 'Error ejecutando la accion'
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}

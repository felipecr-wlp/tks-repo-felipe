/**
 * GET  /api/connectors/installs?workspace_id=xxx, complementos instalados
 * POST /api/connectors/installs, instala un complemento con los permisos que se le conceden
 * Solo admin/owner del workspace.
 *
 * Instalar concede permisos, y por eso la pantalla los muestra ANTES de aceptar y
 * esta ruta los vuelve a validar. Dos reglas que no se aflojan:
 *
 *   1. Solo se conceden scopes que la app PIDIO y que existen en el catalogo. Sin
 *      eso, quien arma la peticion podria concederse permisos que la herramienta
 *      nunca declaro, y la pantalla de instalacion estaria mintiendo.
 *   2. El token es de la INSTALACION, no de quien la hizo. Se devuelve una sola
 *      vez en texto plano; en la base queda solo el hash.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { applyRateLimit } from '@/lib/rate-limit'
import { generateConnectorToken, hashToken, tokenPrefix } from '@/lib/connectors/keys'
import { ALL_SCOPES } from '@/lib/connectors/scopes'
import { RE_APP_ID } from '@/lib/validation'

// Vigencia del token de instalacion. Un token sin fecha de muerte sobrevive a la
// herramienta, al proyecto y a quien lo creo: seis meses obliga a que alguien
// vuelva a mirar si esto sigue haciendo falta.
const TOKEN_DIAS = 180

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  // Ya no es la lista fija de las tres apps de casa: el catalogo es abierto y
  // quien manda es la fila en connector_apps, que ademas tiene que estar aprobada.
  app_id: z.string().regex(RE_APP_ID),
  manifest: z.record(z.any()).default({}),
  enabled: z.boolean().default(true),
  granted_scopes: z.array(z.string()).max(20).default([]),
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
    .select('id, app_id, manifest, enabled, installed_at, updated_at, granted_scopes, token_prefix, token_expires_at')
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
  const { workspace_id, app_id, manifest, enabled, granted_scopes } = parsed.data

  const gate = await isWorkspaceAdminById(workspace_id)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const admin = createAdminClient()

  // La app tiene que existir Y estar aprobada. Instalar un borrador seria saltarse
  // la revision entera con una peticion a mano.
  const { data: app } = (await admin
    .from('connector_apps')
    .select('id, status, requested_scopes')
    .eq('id', app_id)
    .maybeSingle()) as { data: { id: string; status: string; requested_scopes: string[] | null } | null; error: unknown }

  if (!app) return NextResponse.json({ error: 'Esa herramienta no existe' }, { status: 404 })
  if (app.status !== 'approved') {
    return NextResponse.json({ error: 'Esa herramienta todavia no esta aprobada' }, { status: 409 })
  }

  const pedidos = (app.requested_scopes ?? []).filter((s) => ALL_SCOPES.includes(s))
  const deMas = granted_scopes.filter((s) => !pedidos.includes(s))
  if (deMas.length > 0) {
    return NextResponse.json(
      { error: `Esa herramienta no pidio: ${deMas.join(', ')}` },
      { status: 422 },
    )
  }

  const token = generateConnectorToken(process.env.NODE_ENV === 'production' ? 'live' : 'test')
  const expira = new Date(Date.now() + TOKEN_DIAS * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = (await admin
    .from('connector_installs')
    .insert({
      workspace_id,
      app_id,
      manifest,
      enabled,
      granted_scopes,
      token_hash: hashToken(token),
      token_prefix: tokenPrefix(token),
      token_expires_at: expira,
      installed_by: gate.userId,
    })
    .select('id, app_id, manifest, enabled, installed_at, updated_at, granted_scopes, token_prefix, token_expires_at')
    .single()) as { data: unknown; error: unknown }

  if (error || !data) {
    const dup = (error as { code?: string } | null)?.code === '23505'
    return NextResponse.json(
      { error: dup ? 'Esa herramienta ya esta instalada en este workspace' : 'No se pudo instalar' },
      { status: dup ? 409 : 500 },
    )
  }

  // Unica vez que el token viaja en claro. No se guarda en ningun lado mas que en
  // manos de quien lo esta viendo ahora.
  return NextResponse.json({ install: data, token }, { status: 201 })
}

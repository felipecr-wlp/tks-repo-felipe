/**
 * GET  /api/connectors/apps?workspace_id=xxx  catalogo de herramientas del marketplace
 * POST /api/connectors/apps                   propone una herramienta nueva (queda en borrador)
 *
 * Este es el catalogo de herramientas EXTERNAS: cada una vive en su propio deploy
 * y su propio repo. WLO no compila nada de nadie, solo guarda a donde apunta, que
 * permisos pidio y en que estado de revision esta.
 *
 * Quien ve: cualquier miembro del workspace. Ver el catalogo no instala nada, y un
 * catalogo que solo ve quien ya sabe que hay adentro no sirve de catalogo.
 * Quien propone: cualquier miembro, pero nace en 'draft' y en borrador NO se puede
 * instalar. Aprobar es otra ruta y otro permiso.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { applyRateLimit } from '@/lib/rate-limit'
import { isUuid, RE_APP_ID } from '@/lib/validation'
import { ALL_SCOPES } from '@/lib/connectors/scopes'
import { originOf } from '@/lib/connectors/embed'
import { loadCatalog } from '@/lib/connectors/catalog'

export async function GET(request: NextRequest) {
  const workspaceId = new URL(request.url).searchParams.get('workspace_id')
  if (!workspaceId || !isUuid(workspaceId)) {
    return NextResponse.json({ error: 'workspace_id requerido' }, { status: 422 })
  }

  const gate = await isWorkspaceAdminById(workspaceId)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  // Ser miembro es el piso. `role` nulo y sin mando de organizacion = no pertenece.
  if (!gate.role && !gate.isAdmin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  const admin = createAdminClient()
  const catalogo = await loadCatalog(admin, workspaceId)

  return NextResponse.json({ apps: catalogo, is_admin: gate.isAdmin })
}

const proposeSchema = z.object({
  workspace_id: z.string().uuid(),
  id: z.string().regex(RE_APP_ID, 'Solo minusculas, numeros y guion'),
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional(),
  base_url: z.string().url(),
  icon: z.string().max(40).optional(),
  kind: z.enum(['connector', 'embed']).default('connector'),
  embed_path: z.string().max(200).optional(),
  requested_scopes: z.array(z.string()).max(20).default([]),
})

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }

  const parsed = proposeSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos', details: parsed.error.flatten() }, { status: 422 })
  }
  const d = parsed.data

  const gate = await isWorkspaceAdminById(d.workspace_id)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.role && !gate.isAdmin) return NextResponse.json({ error: 'No autorizado' }, { status: 403 })

  // Un scope que no esta en el catalogo no existe. Guardarlo "por si acaso"
  // convertiria la pantalla de instalacion en una lista de texto libre, y ahi ya
  // no habria forma de decirle a nadie que esta aceptando.
  const desconocidos = d.requested_scopes.filter((s) => !ALL_SCOPES.includes(s))
  if (desconocidos.length > 0) {
    return NextResponse.json({ error: `Permisos desconocidos: ${desconocidos.join(', ')}` }, { status: 422 })
  }

  if (!originOf(d.base_url)) {
    return NextResponse.json({ error: 'La URL debe ser https' }, { status: 422 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('connector_apps').insert({
    id: d.id,
    name: d.name,
    description: d.description ?? null,
    base_url: d.base_url,
    icon: d.icon ?? null,
    kind: d.kind,
    embed_path: d.embed_path ?? null,
    requested_scopes: d.requested_scopes,
    owner_profile_id: gate.userId,
    status: 'draft',
  })

  if (error) {
    const dup = (error as { code?: string }).code === '23505'
    return NextResponse.json(
      { error: dup ? 'Ya existe una herramienta con ese identificador' : 'No se pudo proponer' },
      { status: dup ? 409 : 500 },
    )
  }

  return NextResponse.json({ ok: true, status: 'draft' }, { status: 201 })
}

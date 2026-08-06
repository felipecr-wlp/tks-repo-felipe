/**
 * PATCH /api/connectors/apps/<appId>  revisa una herramienta propuesta
 *
 * Aprobar es lo que separa "alguien subio un link" de "esto se puede instalar".
 * Por eso NO lo hace un admin de workspace: lo hace el mando de la organizacion.
 * Un admin de workspace decide que se instala en SU workspace; decidir que entra
 * al catalogo de todos es otra cosa y otro nivel.
 *
 * Se puede corregir aqui la URL, la ruta de embebido y los permisos que pide,
 * porque revisar sin poder corregir obliga a rechazar por una coma. Lo que NO
 * pasa: cambiar `requested_scopes` no concede nada. Los workspaces que ya la
 * tienen instalada siguen con lo que aceptaron y les aparece pendiente lo nuevo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/auth'
import { applyRateLimit } from '@/lib/rate-limit'
import { ALL_SCOPES } from '@/lib/connectors/scopes'
import { originOf } from '@/lib/connectors/embed'
import { isAppId } from '@/lib/validation'

const patchSchema = z.object({
  status: z.enum(['draft', 'approved', 'retired']).optional(),
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  base_url: z.string().url().optional(),
  kind: z.enum(['connector', 'embed']).optional(),
  embed_path: z.string().max(200).nullable().optional(),
  requested_scopes: z.array(z.string()).max(20).optional(),
})

export async function PATCH(
  request: NextRequest,
  { params }: { params: { appId: string } },
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  if (!isAppId(params.appId)) {
    return NextResponse.json({ error: 'Identificador invalido' }, { status: 422 })
  }

  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', user.id)
    .maybeSingle()) as { data: { org_role: string | null } | null; error: unknown }

  const orgRole = profile?.org_role ?? 'member'
  if (orgRole !== 'owner' && orgRole !== 'admin') {
    return NextResponse.json({ error: 'Solo el mando de la organizacion revisa el catalogo' }, { status: 403 })
  }

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos invalidos' }, { status: 422 })
  const d = parsed.data

  if (d.requested_scopes) {
    const desconocidos = d.requested_scopes.filter((s) => !ALL_SCOPES.includes(s))
    if (desconocidos.length > 0) {
      return NextResponse.json({ error: `Permisos desconocidos: ${desconocidos.join(', ')}` }, { status: 422 })
    }
  }
  if (d.base_url && !originOf(d.base_url)) {
    return NextResponse.json({ error: 'La URL debe ser https' }, { status: 422 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const k of ['status', 'name', 'description', 'base_url', 'kind', 'embed_path', 'requested_scopes'] as const) {
    if (d[k] !== undefined) patch[k] = d[k]
  }

  const { error } = await admin
    .from('connector_apps')
    .update(patch as never)
    .eq('id', params.appId)

  if (error) return NextResponse.json({ error: 'No se pudo actualizar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { appId: string } },
) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  if (!isAppId(params.appId)) {
    return NextResponse.json({ error: 'Identificador invalido' }, { status: 422 })
  }

  const user = await getCachedUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = (await admin
    .from('profiles')
    .select('org_role')
    .eq('id', user.id)
    .maybeSingle()) as { data: { org_role: string | null } | null; error: unknown }

  const orgRole = profile?.org_role ?? 'member'
  if (orgRole !== 'owner' && orgRole !== 'admin') {
    return NextResponse.json({ error: 'Solo el mando de la organizacion elimina herramientas' }, { status: 403 })
  }

  // No se pueden eliminar las apps de casa (wli, wlo, wlm)
  if (params.appId === 'wli' || params.appId === 'wlo' || params.appId === 'wlm') {
    return NextResponse.json({ error: 'Las apps del sistema no se pueden eliminar' }, { status: 403 })
  }

  // Verificar que no tenga instalaciones activas
  const { count } = (await admin
    .from('connector_installs')
    .select('id', { count: 'exact', head: true })
    .eq('app_id', params.appId)) as { count: number | null; error: unknown }

  if (count && count > 0) {
    return NextResponse.json({
      error: `Tiene ${count} instalacion(es) activa(s). Retirala primero antes de eliminar.`,
    }, { status: 409 })
  }

  const { error } = await admin
    .from('connector_apps')
    .delete()
    .eq('id', params.appId)

  if (error) return NextResponse.json({ error: 'No se pudo eliminar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

/**
 * GET /api/connectors/wli/sequences?workspace_id=xxx
 * Secuencias activas del Emailer de WLI, para poder ELEGIRLAS en un select.
 *
 * Existe para que el token del conector no salga nunca del servidor. El navegador
 * pide "dame las secuencias", este endpoint hace la llamada saliente con la key
 * que solo vive en el entorno, y devuelve una lista de id y nombre. Sin esto, la
 * unica forma de configurar la accion de correo seria pegar a mano el UUID de la
 * secuencia copiado del Emailer, y un UUID mal pegado no da error: enrola a la
 * persona en la secuencia equivocada.
 *
 * Acceso: miembro del workspace. Es lectura de un catalogo de nombres de
 * campaña, no de contactos ni de resultados, asi que no se exige admin: quien
 * puede crear una automatizacion del proyecto tiene que poder ver las opciones.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { callConnector } from '@/lib/connectors/outbound'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const workspaceId = new URL(request.url).searchParams.get('workspace_id')
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id requerido' }, { status: 422 })
  }

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: member } = (await admin
    .from('workspace_members')
    .select('workspace_id')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', user.id)
    .maybeSingle()) as { data: { workspace_id: string } | null }

  if (!member) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const r = await callConnector({
    app: 'wli',
    action: 'emailer/list_sequences',
    payload: { solo_activas: true },
    admin,
    workspaceId,
  })

  if (!r.ok) {
    // Se devuelve el status real (409 sin instalar, 503 sin configurar, 502/504
    // si WLI no contesta) para que la UI pueda decir QUE falta en vez de un
    // "error" generico que obliga a abrir los logs.
    return NextResponse.json({ error: r.error }, { status: r.status })
  }

  const data = r.data as { sequences?: { id: string; name: string }[] } | null
  return NextResponse.json({ sequences: data?.sequences ?? [] })
}

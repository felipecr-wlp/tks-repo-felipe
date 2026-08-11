/**
 * GET /api/connectors/wli/check?workspace_id=xxx
 * Prueba la conexion de WLO a WLI para el boton "Probar conexion" del editor de
 * automatizaciones (y cualquier otra pantalla que configure un envio).
 *
 * No envia nada: solo verifica el estado del canal saliente. El orden dice todo:
 * si no esta instalado devuelve 409 antes de tocar la red, si al servidor le
 * falta configuracion devuelve 503, y solo entonces sale a la red con un ping.
 * Si WLI responde pero aun no implementa el ping del contrato (404), se prueba
 * con una accion real (list_sequences) para saber si los envios funcionan.
 *
 * Acceso: miembro del workspace, igual que el resto del panel de automatizaciones.
 * Es una prueba de conexion de solo lectura, no expone contactos ni resultados.
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

  const inicio = performance.now()
  const r = await callConnector({
    app: 'wli',
    action: 'ping',
    payload: { echo: 'check de conexion' },
    admin,
    workspaceId,
  })
  const latenciaMs = Math.round(performance.now() - inicio)

  if (r.ok) {
    return NextResponse.json({
      connected: true,
      latenciaMs,
      detalle: `Conectado a WLI · ${latenciaMs}ms`,
    })
  }

  if (r.status === 404) {
    // WLI esta vivo pero no implementa el ping del contrato. Para no dar por
    // muerta una conexion que funciona, se prueba con una accion real.
    const r2 = await callConnector({
      app: 'wli',
      action: 'emailer/list_sequences',
      payload: { solo_activas: true },
      admin,
      workspaceId,
    })
    if (r2.ok) {
      return NextResponse.json({
        connected: true,
        latenciaMs,
        detalle: `WLI responde (${latenciaMs}ms) y las acciones funcionan. Falta implementar el ping en WLI.`,
      })
    }
    return NextResponse.json({
      connected: false,
      latenciaMs,
      error: `${r.error}. Las acciones tampoco respondieron: ${r2.error}`,
    }, { status: r2.status })
  }

  return NextResponse.json({ connected: false, error: r.error }, { status: r.status })
}

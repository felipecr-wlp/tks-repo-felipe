/**
 * GET /api/connectors/diagnostico?workspace_id=xxx
 *
 * Modulo de diagnostico del ecosistema de conectores: prueba la conexion a cada
 * app (wli/wlo/wlm), lista los permisos que expone y el estado de despliegue de
 * cada uno, y adjunta el manual de comunicacion. Todo lo pesado vive en
 * `src/lib/connectors/diagnostico.ts`; esta ruta solo cierra la puerta.
 *
 * Acceso: SOLO admin del workspace. El reporte dice si el servidor tiene
 * configurada la conexion saliente y si el complemento esta instalado, que es
 * material de administracion, no de cualquier miembro.
 *
 * No sale a la red con una llamada HTTP cruda: la unica salida a la red es
 * `callConnector`, que ya esta en la lista blanca del tripwire anti-SSRF y
 * aplica timeout y DNS.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { applyRateLimit } from '@/lib/rate-limit'
import { buildDiagnostico } from '@/lib/connectors/diagnostico'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const workspaceId = new URL(request.url).searchParams.get('workspace_id')
  if (!workspaceId) {
    return NextResponse.json({ error: 'workspace_id requerido' }, { status: 422 })
  }

  const gate = await isWorkspaceAdminById(workspaceId)
  if (!gate) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!gate.isAdmin) return NextResponse.json({ error: 'Solo admin' }, { status: 403 })

  const admin = createAdminClient()
  const reporte = await buildDiagnostico(admin, workspaceId)
  return NextResponse.json(reporte)
}

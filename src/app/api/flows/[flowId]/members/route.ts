/**
 * GET /api/flows/[flowId]/members
 * Lista las personas del workspace del flujo, para poblar el dialogo de compartir.
 *
 * Devuelve CORREOS, asi que la puerta importa mas que el contenido. Antes esta
 * ruta solo pedia sesion: con un UUID de flujo cualquiera, una persona autenticada
 * de OTRO workspace se llevaba el directorio completo del ajeno (IDOR de lectura,
 * OWASP API1). El admin client se salta RLS, asi que la unica defensa es este
 * chequeo explicito.
 *
 * Se reutiliza `resolveFlowAccess` en vez de mirar solo la membresia: es la misma
 * regla que ya gobierna leer el flujo, y ademas cubre el caso del flujo privado.
 * Quien no puede ver el flujo tampoco tiene por que saber quien esta en el equipo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { resolveFlowAccess } from '@/lib/flows/access'

interface RouteParams { params: { flowId: string } }

interface FlowRow {
  id: string
  workspace_id: string
  created_by: string | null
  visibility: string
}

interface MemberRow {
  profile: { id: string; email: string; display_name: string | null; avatar_url: string | null } | null
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.flowId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: flow } = (await admin
    .from('flows')
    .select('id, workspace_id, created_by, visibility')
    .eq('id', params.flowId)
    .maybeSingle()) as { data: FlowRow | null; error: unknown }

  if (!flow) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const access = await resolveFlowAccess(admin, {
    flowId: flow.id,
    workspaceId: flow.workspace_id,
    createdBy: flow.created_by,
    visibility: flow.visibility,
    userId: user.id,
  })
  if (access === 'none') {
    return NextResponse.json({ error: 'No encontrado' }, { status: 404 })
  }

  const { data: members } = (await admin
    .from('workspace_members')
    .select('profile:profiles(id, email, display_name, avatar_url)')
    .eq('workspace_id', flow.workspace_id)) as { data: MemberRow[] | null; error: unknown }

  const profiles = (members ?? []).map((m) => m.profile).filter(Boolean)
  return NextResponse.json({ profiles })
}

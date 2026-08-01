/**
 * POST   /api/flows/[flowId]/shares            comparte el flujo con una persona.
 * DELETE /api/flows/[flowId]/shares?shareId=…  le quita el acceso.
 *
 * Compartir es otorgar un permiso, asi que aqui se aplican tres reglas y ninguna
 * es cosmetica:
 *
 *   1. Solo el creador comparte. Poder editar no es poder repartir llaves.
 *   2. El destinatario DEBE ser miembro del workspace del flujo. Sin este filtro
 *      se podia sembrar un share hacia una cuenta de otro inquilino: `resolveFlowAccess`
 *      exige membresia y hoy lo frenaria, pero la fila quedaria ahi esperando a
 *      que esa persona entre al workspace algun dia. El permiso no se otorga
 *      "por si acaso": se otorga a quien ya pertenece.
 *   3. El share se borra siempre acotado al flujo de la ruta, nunca por id suelto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const shareSchema = z.object({
  profile_id: z.string().uuid(),
  permission: z.enum(['view', 'edit']).default('view'),
}).strict()

interface RouteParams { params: { flowId: string } }

interface FlowOwner {
  id: string
  workspace_id: string
  created_by: string | null
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.flowId)) return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  const parsed = shareSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()
  const { data: flow } = (await admin
    .from('flows')
    .select('id, workspace_id, created_by')
    .eq('id', params.flowId)
    .maybeSingle()) as { data: FlowOwner | null; error: unknown }

  if (!flow) return NextResponse.json({ error: 'Flujo no encontrado' }, { status: 404 })
  if (flow.created_by !== user.id) {
    return NextResponse.json({ error: 'Solo quien creó el flujo puede compartirlo' }, { status: 403 })
  }

  // El destinatario tiene que estar YA dentro del workspace (regla 2 del encabezado).
  const { data: destino } = (await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', flow.workspace_id)
    .eq('profile_id', parsed.data.profile_id)
    .maybeSingle()) as { data: { profile_id: string } | null; error: unknown }

  if (!destino) {
    return NextResponse.json(
      { error: 'Esa persona no pertenece a este workspace' },
      { status: 422 },
    )
  }

  const { data: share, error } = await admin
    .from('flow_shares')
    .insert({
      flow_id: params.flowId,
      profile_id: parsed.data.profile_id,
      permission: parsed.data.permission,
    } as never)
    .select('id, permission, profile:profiles(id, email, display_name, avatar_url)')
    .single()

  if (error || !share) {
    return NextResponse.json({ error: 'No se pudo compartir (quizás ya está compartido)' }, { status: 400 })
  }
  return NextResponse.json(share, { status: 201 })
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.flowId)) return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const url = new URL(request.url)
  const shareId = url.searchParams.get('shareId')
  // Se valida la FORMA antes de tocar la base: un `shareId` que no es uuid hace
  // que Postgres reviente con 22P02 y la ruta responderia 500 por un dato del
  // cliente. Un 422 es la respuesta honesta.
  if (!shareId || !isUuid(shareId)) {
    return NextResponse.json({ error: 'shareId inválido' }, { status: 422 })
  }

  const admin = createAdminClient()
  const { data: flow } = (await admin
    .from('flows')
    .select('id, workspace_id, created_by')
    .eq('id', params.flowId)
    .maybeSingle()) as { data: FlowOwner | null; error: unknown }

  if (!flow) return NextResponse.json({ error: 'Flujo no encontrado' }, { status: 404 })
  if (flow.created_by !== user.id) {
    return NextResponse.json({ error: 'Solo quien creó el flujo puede quitar el acceso' }, { status: 403 })
  }

  // Acotado al flujo de la ruta: sin el `.eq('flow_id')`, un id de share de otro
  // flujo se borraria desde aqui.
  const { error } = await admin
    .from('flow_shares')
    .delete()
    .eq('id', shareId)
    .eq('flow_id', params.flowId)

  if (error) return NextResponse.json({ error: 'No se pudo quitar el acceso' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'

const shareSchema = z.object({
  profile_id: z.string().uuid(),
  permission: z.enum(['view', 'edit']).default('view'),
})

interface RouteParams { params: { flowId: string } }

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.flowId)) return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }
  const parsed = shareSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()
  const { data: flow } = await admin.from('flows').select('id, created_by').eq('id', params.flowId).maybeSingle() as any
  if (!flow) return NextResponse.json({ error: 'Flow no encontrado' }, { status: 404 })
  if (flow.created_by !== user.id) return NextResponse.json({ error: 'Solo el creador puede compartir' }, { status: 403 })

  const { data: share, error } = await admin.from('flow_shares').insert({
    flow_id: params.flowId, profile_id: parsed.data.profile_id, permission: parsed.data.permission,
  }).select('id, permission, profile:profiles(id, email, display_name, avatar_url)').single() as any

  if (error) return NextResponse.json({ error: 'Error al compartir (quizas ya existe)' }, { status: 400 })
  return NextResponse.json(share, { status: 201 })
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.flowId)) return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const url = new URL(request.url)
  const shareId = url.searchParams.get('shareId')
  if (!shareId) return NextResponse.json({ error: 'shareId requerido' }, { status: 422 })

  const admin = createAdminClient()
  const { data: flow } = await admin.from('flows').select('id, created_by').eq('id', params.flowId).maybeSingle() as any
  if (!flow) return NextResponse.json({ error: 'Flow no encontrado' }, { status: 404 })
  if (flow.created_by !== user.id) return NextResponse.json({ error: 'Solo el creador puede quitar acceso' }, { status: 403 })

  const { error } = await admin.from('flow_shares').delete().eq('id', shareId).eq('flow_id', params.flowId)
  if (error) return NextResponse.json({ error: 'Error al quitar acceso' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

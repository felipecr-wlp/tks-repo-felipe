/* eslint-disable @typescript-eslint/no-explicit-any */
// React Flow trabaja con nodos y edges de forma dinamica: el contenido de cada
// nodo lo define el usuario en tiempo de ejecucion. Tipar cada acceso aqui no
// aporta seguridad real, asi que la regla se apaga en este archivo a proposito.
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'

interface RouteParams { params: { flowId: string } }

export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.flowId)) return NextResponse.json({ error: 'ID invalido' }, { status: 422 })
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { data: flow } = await admin.from('flows').select('id, workspace_id').eq('id', params.flowId).maybeSingle() as any
  if (!flow) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const { data: members } = await admin
    .from('workspace_members')
    .select('profile:profiles(id, email, display_name, avatar_url)')
    .eq('workspace_id', flow.workspace_id) as { data: any[] | null; error: unknown }

  const profiles = (members ?? []).map((m: any) => m.profile).filter(Boolean)
  return NextResponse.json({ profiles })
}

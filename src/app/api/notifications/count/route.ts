/**
 * GET /api/notifications/count?workspace=<slug>
 * Devuelve el numero de notificaciones sin leer del usuario autenticado, opcional
 * scoping por workspace (slug). Alimenta el badge de la Bandeja en el sidebar
 * (Circuito 2.C). Barato: solo cuenta, sin traer filas.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const slug = new URL(request.url).searchParams.get('workspace')?.trim()

  let query = admin
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_id', user.id)
    .eq('is_read', false)

  if (slug) {
    // Resolver slug -> workspace_id a traves de una membership del propio user
    // (anti-IDOR: solo cuenta en workspaces donde de verdad pertenece).
    type WsRow = { workspaces: { id: string } | null }
    const { data: row } = await admin
      .from('workspace_members')
      .select('workspaces!inner ( id )')
      .eq('profile_id', user.id)
      .eq('workspaces.slug', slug)
      .limit(1)
      .maybeSingle() as { data: WsRow | null; error: unknown }

    const workspaceId = row?.workspaces?.id
    if (!workspaceId) return NextResponse.json({ unread: 0 })
    query = query.eq('workspace_id', workspaceId)
  }

  const { count } = await query
  return NextResponse.json({ unread: count ?? 0 })
}

/**
 * POST /api/notifications/mark-all-read, marca todas las del user como leídas.
 * Cuerpo opcional { workspace?: string }: si se envia el slug, solo marca las
 * notificaciones de ESE workspace (coincide con lo que la Bandeja muestra). Se
 * resuelve slug -> workspace_id a traves de una membership del propio usuario
 * (anti-IDOR: solo actua en workspaces donde de verdad pertenece). Sin cuerpo,
 * conserva el comportamiento previo (marca todas, en cualquier workspace).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

const bodySchema = z.object({
  workspace: z.string().trim().min(1).max(100).optional(),
})

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  // Cuerpo opcional: puede venir vacio (sin JSON) o con { workspace }.
  let slug: string | undefined
  try {
    const raw = await request.json()
    const parsed = bodySchema.safeParse(raw)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })
    }
    slug = parsed.data.workspace
  } catch {
    // Sin cuerpo: se marca en todos los workspaces (comportamiento previo).
  }

  const admin = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (admin as any)
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_id', user.id)
    .eq('is_read', false)

  if (slug) {
    type WsRow = { workspaces: { id: string } | null }
    const { data: row } = await admin
      .from('workspace_members')
      .select('workspaces!inner ( id )')
      .eq('profile_id', user.id)
      .eq('workspaces.slug', slug)
      .limit(1)
      .maybeSingle() as { data: WsRow | null; error: unknown }

    const workspaceId = row?.workspaces?.id
    // Anti-IDOR: si el user no pertenece a ese workspace, no marca nada.
    if (!workspaceId) return NextResponse.json({ ok: true })
    query = query.eq('workspace_id', workspaceId)
  }

  const { error } = await query

  if (error) {
    return NextResponse.json({ error: 'Error al marcar' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { z } from 'zod'

interface RouteParams { params: { pluginId: string } }

const configSchema = z.object({
  enabled: z.boolean().optional(),
  manifest: z.record(z.any()).optional(),
})

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }
  const parsed = configSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos invalidos' }, { status: 422 })

  const admin = createAdminClient()

  const { data: install } = await admin
    .from('connector_installs')
    .select('id, workspace_id')
    .eq('id', params.pluginId)
    .maybeSingle() as { data: { id: string; workspace_id: string } | null; error: unknown }
  if (!install) return NextResponse.json({ error: 'No encontrado' }, { status: 404 })

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', install.workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admins' }, { status: 403 })
  }

  const update: Record<string, any> = {}
  if (parsed.data.enabled !== undefined) update.enabled = parsed.data.enabled
  if (parsed.data.manifest !== undefined) update.manifest = parsed.data.manifest

  const { error } = await admin.from('connector_installs').update(update).eq('id', params.pluginId)
  if (error) return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })

  return NextResponse.json({ ok: true })
}

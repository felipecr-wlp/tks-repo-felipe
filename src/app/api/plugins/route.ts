import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { z } from 'zod'

const installSchema = z.object({
  workspace_id: z.string().uuid(),
  app_id: z.string(),
  plugin_type: z.enum(['widget']).default('widget'),
  enabled: z.boolean().default(true),
})

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }
  const parsed = installSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos invalidos' }, { status: 422 })

  const admin = createAdminClient()
  const { workspace_id, app_id, plugin_type, enabled } = parsed.data

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership || membership.role !== 'admin') {
    return NextResponse.json({ error: 'Solo admins pueden instalar plugins' }, { status: 403 })
  }

  const { data: install, error } = await admin
    .from('connector_installs')
    .insert({ workspace_id, app_id, plugin_type, enabled, installed_by: user.id })
    .select('id, app_id, plugin_type, enabled')
    .single() as { data: any; error: unknown }

  if (error) {
    console.error('[plugins POST]', error)
    return NextResponse.json({ error: 'Error al instalar' }, { status: 500 })
  }

  return NextResponse.json(install, { status: 201 })
}

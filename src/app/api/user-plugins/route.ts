import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: { install_id: string; enabled: boolean }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON invalido' }, { status: 400 }) }

  const admin = createAdminClient()
  const { error } = await admin
    .from('user_plugin_settings')
    .upsert({ user_id: user.id, install_id: body.install_id, enabled: body.enabled },
      { onConflict: 'user_id,install_id' }) as any

  if (error) return NextResponse.json({ error: 'Error al guardar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

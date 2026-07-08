/**
 * POST /api/workspaces — Crea un workspace adicional en la organización.
 * Solo admins de la org pueden crear workspaces.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { slugify } from '@/lib/utils'

const schema = z.object({
  org_id: z.string().uuid(),
  name:   z.string().min(2).max(80).trim(),
})

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'auth')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { org_id, name } = parsed.data

  const admin = createAdminClient()

  // Solo admins de la org (admin client bypass RLS)
  const { data: orgMembership } = await admin
    .from('org_members')
    .select('role')
    .eq('org_id', org_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!orgMembership || orgMembership.role !== 'admin') {
    return NextResponse.json({ error: 'Se requiere ser admin de la organización' }, { status: 403 })
  }

  // Slug único dentro de la org
  let slug = slugify(name)
  type SlugCheck = { slug: string }
  const { data: existing } = await admin
    .from('workspaces')
    .select('slug')
    .eq('org_id', org_id)
    .eq('slug', slug)
    .maybeSingle() as { data: SlugCheck | null; error: unknown }
  if (existing) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`

  type WsResult = { id: string; name: string; slug: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: workspace, error: insertError } = await (admin as any)
    .from('workspaces')
    .insert({ org_id, name, slug })
    .select('id, name, slug')
    .single() as { data: WsResult | null; error: unknown }

  if (insertError || !workspace) {
    console.error('[workspaces POST] insert error:', insertError)
    return NextResponse.json({ error: 'Error al crear el workspace' }, { status: 500 })
  }

  // Agregar al creador como admin
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from('workspace_members')
    .insert({ workspace_id: workspace.id, profile_id: user.id, role: 'admin' })

  return NextResponse.json(workspace, { status: 201 })
}

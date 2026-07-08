/**
 * POST /api/onboarding
 * Crea organización + workspace inicial + perfil del usuario.
 * Solo para usuarios nuevos sin organización.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { slugify } from '@/lib/utils'

const schema = z.object({
  orgName: z.string().min(2).max(80).trim(),
  workspaceName: z.string().min(2).max(80).trim(),
})

export async function POST(request: NextRequest) {
  // ── Rate limit ─────────────────────────────────────────────────────────────
  const limited = await applyRateLimit(request, 'auth')
  if (limited) return limited

  // ── Auth ───────────────────────────────────────────────────────────────────
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  // ── Validar body ───────────────────────────────────────────────────────────
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos inválidos', details: parsed.error.flatten() },
      { status: 422 }
    )
  }

  const { orgName, workspaceName } = parsed.data

  // ── Verificar que no tenga org ya ──────────────────────────────────────────
  type ProfileCheck = { org_id: string | null }
  const { data: profile } = await supabase
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .single() as { data: ProfileCheck | null; error: unknown }

  if (profile?.org_id) {
    return NextResponse.json(
      { error: 'Ya perteneces a una organización' },
      { status: 409 }
    )
  }

  // ── Crear organización + workspace usando service_role ─────────────────────
  // (necesitamos service_role para saltear RLS en la creación inicial)
  const admin = createAdminClient()

  // 1. Crear organización
  const orgSlug = slugify(orgName)
  type OrgInsert = { id: string; slug: string }
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: orgName, slug: orgSlug })
    .select('id, slug')
    .single() as { data: OrgInsert | null; error: unknown }

  if (orgError || !org) {
    console.error('[onboarding] org insert error:', orgError)
    // Si el slug ya existe, agregar sufijo
    const orgSlugAlt = `${orgSlug}-${Math.random().toString(36).slice(2, 6)}`
    const { data: orgAlt, error: orgAltError } = await admin
      .from('organizations')
      .insert({ name: orgName, slug: orgSlugAlt })
      .select('id, slug')
      .single() as { data: OrgInsert | null; error: unknown }

    if (orgAltError || !orgAlt) {
      return NextResponse.json(
        { error: 'Error al crear la organización' },
        { status: 500 }
      )
    }
    // Continuar con orgAlt
    return await finishOnboarding(admin, supabase, user, orgAlt, workspaceName)
  }

  return await finishOnboarding(admin, supabase, user, org, workspaceName)
}

// ── Helper: completa el onboarding una vez creada la org ──────────────────────
async function finishOnboarding(
  admin: ReturnType<typeof createAdminClient>,
  supabase: ReturnType<typeof createClient>,
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> },
  org: { id: string; slug: string },
  workspaceName: string
): Promise<NextResponse> {
  // 2. Actualizar perfil del usuario (org + rol owner — es quien crea la org)
  const { error: profileError } = await admin
    .from('profiles')
    .update({
      org_id: org.id,
      org_role: 'owner',
      display_name:
        (user.user_metadata?.full_name as string | undefined) ??
        user.email?.split('@')[0] ??
        'Usuario',
      avatar_url: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    })
    .eq('id', user.id)

  if (profileError) {
    console.error('[onboarding] profile update error:', profileError)
    return NextResponse.json({ error: 'Error al actualizar perfil' }, { status: 500 })
  }

  // 3. Agregar como admin de la org
  const { error: orgMemberError } = await admin
    .from('org_members')
    .insert({ org_id: org.id, profile_id: user.id, role: 'admin' })

  if (orgMemberError) {
    console.error('[onboarding] org_member insert error:', orgMemberError)
    return NextResponse.json({ error: 'Error al unirse a la organización' }, { status: 500 })
  }

  // 4. Crear workspace
  const wsSlug = slugify(workspaceName)
  type WsInsert = { id: string; slug: string }
  const { data: ws, error: wsError } = await admin
    .from('workspaces')
    .insert({
      org_id: org.id,
      name: workspaceName,
      slug: wsSlug,
    })
    .select('id, slug')
    .single() as { data: WsInsert | null; error: unknown }

  if (wsError || !ws) {
    console.error('[onboarding] workspace insert error:', wsError)
    const wsSlugAlt = `${wsSlug}-${Math.random().toString(36).slice(2, 6)}`
    const { data: wsAlt, error: wsAltError } = await admin
      .from('workspaces')
      .insert({ org_id: org.id, name: workspaceName, slug: wsSlugAlt })
      .select('id, slug')
      .single() as { data: WsInsert | null; error: unknown }

    if (wsAltError || !wsAlt) {
      return NextResponse.json({ error: 'Error al crear el workspace' }, { status: 500 })
    }

    // Agregar como admin del workspace
    await admin
      .from('workspace_members')
      .insert({ workspace_id: wsAlt.id, profile_id: user.id, role: 'admin' })

    return NextResponse.json({ workspaceSlug: wsAlt.slug }, { status: 201 })
  }

  // 5. Agregar como admin del workspace
  const { error: wsMemberError } = await admin
    .from('workspace_members')
    .insert({ workspace_id: ws.id, profile_id: user.id, role: 'admin' })

  if (wsMemberError) {
    console.error('[onboarding] workspace_member insert error:', wsMemberError)
    return NextResponse.json({ error: 'Error al unirse al workspace' }, { status: 500 })
  }

  return NextResponse.json({ workspaceSlug: ws.slug }, { status: 201 })
}

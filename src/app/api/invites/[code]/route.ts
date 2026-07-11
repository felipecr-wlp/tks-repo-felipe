/**
 * GET /api/invites/[code], info pública del invite (workspace name + flags)
 * Requiere usuario autenticado pero no membership.
 * NUNCA expone password_hash.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { code: string }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const limited = await applyRateLimit(request, 'auth')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  // Usar admin para evitar dependencias circulares de RLS al consultar el workspace
  const admin = createAdminClient()

  type InviteWithWs = {
    id: string
    workspace_id: string
    role: string
    max_uses: number | null
    uses_count: number
    expires_at: string | null
    revoked_at: string | null
    password_hash: string | null
    workspaces: {
      id: string
      name: string
      slug: string
      org_id: string
      organizations: { name: string } | null
    } | null
  }

  const { data: invite } = await admin
    .from('workspace_invites')
    .select(`
      id,
      workspace_id,
      role,
      max_uses,
      uses_count,
      expires_at,
      revoked_at,
      password_hash,
      workspaces ( id, name, slug, org_id, organizations ( name ) )
    `)
    .eq('code', params.code)
    .single() as { data: InviteWithWs | null; error: unknown }

  if (!invite || !invite.workspaces) {
    return NextResponse.json({ error: 'Invite no encontrado' }, { status: 404 })
  }

  // Validar estado
  if (invite.revoked_at) {
    return NextResponse.json({ error: 'Invite revocado' }, { status: 410 })
  }
  if (invite.expires_at && new Date(invite.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Invite expirado' }, { status: 410 })
  }
  if (invite.max_uses != null && invite.uses_count >= invite.max_uses) {
    return NextResponse.json({ error: 'Invite agotado' }, { status: 410 })
  }

  return NextResponse.json({
    workspace_name: invite.workspaces.name,
    workspace_slug: invite.workspaces.slug,
    org_name: invite.workspaces.organizations?.name ?? null,
    role: invite.role,
    has_password: invite.password_hash != null,
  })
}

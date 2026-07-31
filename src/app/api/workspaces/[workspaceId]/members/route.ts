/**
 * GET /api/workspaces/[workspaceId]/members
 * Lista los miembros del workspace con su perfil y rol. Solo admins.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { normalizeHidden } from '@/lib/features'

export async function GET(
  request: NextRequest,
  { params }: { params: { workspaceId: string } }
) {
  if (!isUuid(params.workspaceId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const auth = await isWorkspaceAdminById(params.workspaceId)
  if (!auth) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  if (!auth.isAdmin) return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })

  const admin = createAdminClient()

  type MemberRow = {
    profile_id: string
    role: string
    created_at: string
    hidden_features: string[] | null
    profiles: { id: string; display_name: string | null; email: string | null; avatar_url: string | null } | null
  }

  const { data } = (await admin
    .from('workspace_members')
    .select('profile_id, role, created_at, hidden_features, profiles ( id, display_name, email, avatar_url )')
    .eq('workspace_id', params.workspaceId)
    .order('created_at', { ascending: true })) as { data: MemberRow[] | null; error: unknown }

  const members = (data ?? []).map((m) => ({
    profile_id: m.profile_id,
    role: m.role,
    created_at: m.created_at,
    hidden_features: normalizeHidden(m.hidden_features),
    display_name: m.profiles?.display_name ?? 'Usuario',
    email: m.profiles?.email ?? '',
    avatar_url: m.profiles?.avatar_url ?? null,
  }))

  return NextResponse.json({ members })
}

/**
 * DELETE /api/workspaces/[workspaceId]/invites/[inviteId], revoca un invite
 * Solo admins del workspace o de la org.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/types'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'

interface RouteParams {
  params: { workspaceId: string; inviteId: string }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.workspaceId) || !isUuid(params.inviteId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'auth')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  // RLS ya restringe a admins; la query falla si no tiene permisos
  // El cliente RLS de @supabase/ssr tipa el parametro de .update() como `never`
  // para esta tabla, asi que se castea SOLO el payload (no el cliente) a su tipo
  // Update real. Ver types.ts (Update de workspace_invites).
  const revokePatch = {
    revoked_at: new Date().toISOString(),
  } as Database['public']['Tables']['workspace_invites']['Update']
  const { data, error } = await supabase
    .from('workspace_invites')
    .update(revokePatch as never)
    .eq('id', params.inviteId)
    .eq('workspace_id', params.workspaceId)
    .is('revoked_at', null)
    .select('id')
    .single() as { data: { id: string } | null; error: unknown }

  if (error || !data) {
    return NextResponse.json({ error: 'No se pudo revocar el invite' }, { status: 403 })
  }

  await logActivity({
    verb: ActivityVerbs.WORKSPACE_INVITE_REVOKED,
    subject_id: user.id,
    object_type: 'workspace_invite',
    object_id: data.id,
    workspace_id: params.workspaceId,
  })

  return NextResponse.json({ ok: true })
}

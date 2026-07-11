/**
 * DELETE /api/workspaces/[workspaceId]/invites/[inviteId], revoca un invite
 * Solo admins del workspace o de la org.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'

interface RouteParams {
  params: { workspaceId: string; inviteId: string }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const limited = await applyRateLimit(request, 'auth')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  // RLS ya restringe a admins; la query falla si no tiene permisos
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from('workspace_invites')
    .update({ revoked_at: new Date().toISOString() })
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

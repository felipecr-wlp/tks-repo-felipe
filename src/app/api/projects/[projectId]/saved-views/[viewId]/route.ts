/**
 * DELETE /api/projects/[projectId]/saved-views/[viewId], borra una vista guardada propia.
 *
 * Anti-IDOR: valida membresia del proyecto y ademas que la vista pertenezca al
 * usuario (profile_id), para que nadie borre las vistas privadas de otro.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { projectId: string; viewId: string }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', params.projectId)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('task_saved_views')
    .delete()
    .eq('id', params.viewId)
    .eq('project_id', params.projectId)
    .eq('profile_id', user.id)

  if (error) {
    console.error('[saved-views DELETE] error:', error)
    return NextResponse.json({ error: 'Error al borrar la vista' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

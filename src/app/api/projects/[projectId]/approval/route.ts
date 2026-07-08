/**
 * PATCH /api/projects/[projectId]/approval
 * SOLO administradores de la organizacion (org owner/admin) aprueban o rechazan
 * un proyecto propuesto que quedo en 'pending'.
 *
 *   - approve -> approval_status = 'approved', open_for_applications = true,
 *                approved_by/at seteados, avisa al proponente (lead).
 *   - reject  -> approval_status = 'rejected', open_for_applications = false,
 *                avisa al proponente.
 *
 * Admin client (bypass RLS) + verificacion de rol org en el handler (anti-IDOR).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, createNotification, ActivityVerbs, NotificationTypes } from '@/lib/activity'

const schema = z.object({
  decision: z.enum(['approve', 'reject']),
}).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const limited = await applyRateLimit(request)
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

  const admin = createAdminClient()

  // El que decide debe ser administrador de la organizacion.
  const { data: profile } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', user.id)
    .maybeSingle() as { data: { org_role: string } | null }
  const isAdmin = profile?.org_role === 'owner' || profile?.org_role === 'admin'
  if (!isAdmin) return NextResponse.json({ error: 'Solo un administrador puede autorizar proyectos' }, { status: 403 })

  type ProjRow = { id: string; name: string; workspace_id: string; lead_id: string | null; approval_status: string }
  const { data: project } = await admin
    .from('projects')
    .select('id, name, workspace_id, lead_id, approval_status')
    .eq('id', params.projectId)
    .maybeSingle() as { data: ProjRow | null }
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  if (project.approval_status !== 'pending') {
    return NextResponse.json({ error: 'Este proyecto ya fue revisado' }, { status: 409 })
  }

  const nowIso = new Date().toISOString()
  const approving = parsed.data.decision === 'approve'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('projects')
    .update({
      approval_status:       approving ? 'approved' : 'rejected',
      approved_by:           user.id,
      approved_at:           nowIso,
      open_for_applications: approving,
      updated_at:            nowIso,
    })
    .eq('id', project.id)

  if (error) {
    console.error('[approval PATCH] update error:', error)
    return NextResponse.json({ error: 'Error al procesar la decisión' }, { status: 500 })
  }

  logActivity({
    verb: approving ? ActivityVerbs.PROJECT_APPROVED : ActivityVerbs.PROJECT_REJECTED,
    subject_id: user.id,
    object_type: 'project',
    object_id: project.id,
    object_title: project.name,
    workspace_id: project.workspace_id,
    project_id: project.id,
  }).catch(console.error)

  // Avisar al proponente (lider) del resultado.
  if (project.lead_id && project.lead_id !== user.id) {
    createNotification({
      recipient_id: project.lead_id,
      subject_id: user.id,
      type: approving ? NotificationTypes.PROJECT_APPROVED : NotificationTypes.PROJECT_REJECTED,
      object_type: 'project',
      object_id: project.id,
      object_title: project.name,
      workspace_id: project.workspace_id,
    }).catch(console.error)
  }

  return NextResponse.json({
    id: project.id,
    approval_status: approving ? 'approved' : 'rejected',
    open_for_applications: approving,
  })
}

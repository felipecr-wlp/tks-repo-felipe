/**
 * PATCH /api/projects/[projectId]/complete
 * Marca un proyecto como COMPLETADO. Solo el lider/manager del proyecto o un
 * administrador de la organizacion puede hacerlo, y SOLO cuando el progreso
 * llego al 100% (todas las tareas no canceladas estan cerradas, y hay al menos
 * una tarea).
 *
 * Al completar:
 *   - status = 'completed', completed_at/by seteados.
 *   - open_for_applications = false (ya no recibe postulaciones).
 *   - Se avisa a TODOS los miembros para que se califiquen entre si
 *     (la evaluacion de pares se habilita al quedar 'completed').
 *
 * Admin client (bypass RLS) + verificacion de autoridad en el handler.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { computeProjectProgress } from '@/lib/project-progress'
import { logActivity, createNotification, ActivityVerbs, NotificationTypes } from '@/lib/activity'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  type ProjRow = { id: string; name: string; workspace_id: string; lead_id: string | null; status: string }
  const { data: project } = await admin
    .from('projects')
    .select('id, name, workspace_id, lead_id, status')
    .eq('id', params.projectId)
    .maybeSingle() as { data: ProjRow | null }
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  if (project.status === 'completed') {
    return NextResponse.json({ error: 'El proyecto ya esta completado' }, { status: 409 })
  }

  // Autoridad: lider del proyecto, manager, u org owner/admin.
  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', project.id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null }
  const { data: profile } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', user.id)
    .maybeSingle() as { data: { org_role: string } | null }
  const isOrgAdmin = profile?.org_role === 'owner' || profile?.org_role === 'admin'
  const isLead = project.lead_id === user.id
  const isManager = membership?.role === 'manager'
  if (!isLead && !isManager && !isOrgAdmin) {
    return NextResponse.json({ error: 'No tienes permiso para completar este proyecto' }, { status: 403 })
  }

  // Guardia dura: solo se puede completar al 100%.
  const progress = await computeProjectProgress(admin, project.id)
  if (progress.total === 0) {
    return NextResponse.json({ error: 'El proyecto no tiene tareas todavia' }, { status: 422 })
  }
  if (progress.pct < 100) {
    return NextResponse.json({ error: `El proyecto esta al ${progress.pct}%. Solo se completa al 100%.`, progress }, { status: 422 })
  }

  const nowIso = new Date().toISOString()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('projects')
    .update({
      status:                'completed',
      completed_at:          nowIso,
      completed_by:          user.id,
      open_for_applications: false,
      updated_at:            nowIso,
    })
    .eq('id', project.id)

  if (error) {
    console.error('[complete PATCH] update error:', error)
    return NextResponse.json({ error: 'Error al completar el proyecto' }, { status: 500 })
  }

  logActivity({
    verb: ActivityVerbs.PROJECT_COMPLETED,
    subject_id: user.id,
    object_type: 'project',
    object_id: project.id,
    object_title: project.name,
    workspace_id: project.workspace_id,
    project_id: project.id,
  }).catch(console.error)

  // Avisar a todos los miembros: ya pueden calificarse entre si.
  const { data: members } = await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', project.id) as { data: { profile_id: string }[] | null }
  for (const m of members ?? []) {
    if (m.profile_id === user.id) continue
    createNotification({
      recipient_id: m.profile_id,
      subject_id: user.id,
      type: NotificationTypes.REVIEW_REQUESTED,
      object_type: 'project',
      object_id: project.id,
      object_title: project.name,
      workspace_id: project.workspace_id,
    }).catch(console.error)
  }

  return NextResponse.json({
    id: project.id,
    status: 'completed',
    completed_at: nowIso,
    progress,
  })
}

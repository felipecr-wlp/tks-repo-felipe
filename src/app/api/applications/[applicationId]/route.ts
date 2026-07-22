/**
 * PATCH /api/applications/[applicationId]
 * Decide o retira una postulacion.
 *   - status 'accepted' | 'rejected'  -> solo el lider / manager / org admin.
 *       Al aceptar: se agrega al postulante como miembro del proyecto (alimenta
 *       su CV interno) y se le notifica.
 *   - status 'withdrawn'              -> solo el propio postulante.
 *
 * Admin client + verificacion en handler (evita IDOR).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, createNotification, ActivityVerbs, NotificationTypes } from '@/lib/activity'

const schema = z.object({
  status: z.enum(['accepted', 'rejected', 'withdrawn']),
  title:  z.string().max(120).trim().nullable().optional(), // rol/titulo con el que entra al proyecto
}).strict()

export async function PATCH(
  request: NextRequest,
  { params }: { params: { applicationId: string } }
) {
  if (!isUuid(params.applicationId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
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

  type AppRow = {
    id: string; project_id: string; workspace_id: string; applicant_id: string
    status: string; role_desired: string | null
  }
  const { data: application } = await admin
    .from('project_applications')
    .select('id, project_id, workspace_id, applicant_id, status, role_desired')
    .eq('id', params.applicationId)
    .maybeSingle() as { data: AppRow | null }
  if (!application) return NextResponse.json({ error: 'Postulación no encontrada' }, { status: 404 })

  if (application.status !== 'pending') {
    return NextResponse.json({ error: 'Esta postulación ya fue resuelta' }, { status: 409 })
  }

  type ProjRow = { id: string; name: string; lead_id: string | null; max_members: number | null }
  const { data: project } = await admin
    .from('projects')
    .select('id, name, lead_id, max_members')
    .eq('id', application.project_id)
    .maybeSingle() as { data: ProjRow | null }
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })

  const isApplicant = application.applicant_id === user.id

  // ─── Retiro por el propio postulante ────────────────────────────────────────
  if (parsed.data.status === 'withdrawn') {
    if (!isApplicant) return NextResponse.json({ error: 'Solo puedes retirar tu propia postulación' }, { status: 403 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (admin as any)
      .from('project_applications')
      .update({ status: 'withdrawn', decided_by: user.id, decided_at: new Date().toISOString() })
      .eq('id', application.id)
    if (error) return NextResponse.json({ error: 'Error al retirar la postulación' }, { status: 500 })

    logActivity({
      verb: ActivityVerbs.APPLICATION_WITHDRAWN,
      subject_id: user.id,
      object_type: 'project',
      object_id: project.id,
      object_title: project.name,
      workspace_id: application.workspace_id,
      project_id: project.id,
      metadata: { application_id: application.id },
    }).catch(console.error)

    return NextResponse.json({ id: application.id, status: 'withdrawn' })
  }

  // ─── Decision (aceptar/rechazar): lider / manager / org admin ────────────────
  const [{ data: membership }, { data: profile }] = await Promise.all([
    admin.from('project_members').select('role').eq('project_id', project.id).eq('profile_id', user.id).maybeSingle() as Promise<{ data: { role: string } | null }>,
    admin.from('profiles').select('org_role').eq('id', user.id).maybeSingle() as Promise<{ data: { org_role: string } | null }>,
  ])
  const canDecide = project.lead_id === user.id
    || membership?.role === 'manager'
    || profile?.org_role === 'owner' || profile?.org_role === 'admin'
  if (!canDecide) return NextResponse.json({ error: 'Solo el lider o un manager pueden decidir' }, { status: 403 })

  const nowIso = new Date().toISOString()

  if (parsed.data.status === 'accepted') {
    // ¿Ya era miembro? Si el postulante ya esta en el proyecto, aceptar es
    // idempotente y NO consume un cupo nuevo.
    const { data: existingMember } = await admin
      .from('project_members')
      .select('profile_id')
      .eq('project_id', project.id)
      .eq('profile_id', application.applicant_id)
      .maybeSingle() as { data: { profile_id: string } | null }
    const wasMember = existingMember != null

    // Respetar cupo maximo si esta definido (pre-chequeo barato para UX).
    if (project.max_members && !wasMember) {
      const { count } = await admin
        .from('project_members')
        .select('profile_id', { count: 'exact', head: true })
        .eq('project_id', project.id) as { count: number | null }
      if ((count ?? 0) >= project.max_members) {
        return NextResponse.json({ error: 'El proyecto alcanzó su cupo máximo de miembros' }, { status: 409 })
      }
    }

    // Alta como miembro del proyecto (idempotente por onConflict). El titulo
    // alimenta el CV interno; por defecto usa el rol deseado en la postulacion.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from('project_members')
      .upsert(
        {
          project_id: project.id,
          profile_id: application.applicant_id,
          role: 'member',
          title: parsed.data.title ?? application.role_desired ?? null,
          joined_at: nowIso,
        },
        { onConflict: 'project_id,profile_id' }
      )

    // Cierre de la carrera check-then-act: el pre-chequeo y el upsert no son
    // atomicos, asi que dos aceptaciones concurrentes de postulantes distintos
    // podian rebasar el cupo. Solo cuando agregamos un asiento NUEVO, re-contamos
    // y si quedamos por encima del maximo revertimos ESTA alta (no una previa) y
    // devolvemos 409. Al compensar solo el asiento nuevo, las re-aceptaciones
    // idempotentes siguen intactas.
    if (project.max_members && !wasMember) {
      const { count: after } = await admin
        .from('project_members')
        .select('profile_id', { count: 'exact', head: true })
        .eq('project_id', project.id) as { count: number | null }
      if ((after ?? 0) > project.max_members) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (admin as any)
          .from('project_members')
          .delete()
          .eq('project_id', project.id)
          .eq('profile_id', application.applicant_id)
        return NextResponse.json({ error: 'El proyecto alcanzó su cupo máximo de miembros' }, { status: 409 })
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('project_applications')
    .update({ status: parsed.data.status, decided_by: user.id, decided_at: nowIso })
    .eq('id', application.id)
  if (error) return NextResponse.json({ error: 'Error al actualizar la postulación' }, { status: 500 })

  logActivity({
    verb: parsed.data.status === 'accepted' ? ActivityVerbs.APPLICATION_ACCEPTED : ActivityVerbs.APPLICATION_REJECTED,
    subject_id: user.id,
    object_type: 'project',
    object_id: project.id,
    object_title: project.name,
    workspace_id: application.workspace_id,
    project_id: project.id,
    metadata: { application_id: application.id, applicant_id: application.applicant_id },
  }).catch(console.error)

  if (application.applicant_id !== user.id) {
    createNotification({
      recipient_id: application.applicant_id,
      subject_id: user.id,
      type: parsed.data.status === 'accepted' ? NotificationTypes.APPLICATION_ACCEPTED : NotificationTypes.APPLICATION_REJECTED,
      object_type: 'project',
      object_id: project.id,
      object_title: project.name,
      workspace_id: application.workspace_id,
    }).catch(console.error)
  }

  if (parsed.data.status === 'accepted') {
    logActivity({
      verb: ActivityVerbs.PROJECT_MEMBER_ADDED,
      subject_id: user.id,
      object_type: 'project',
      object_id: project.id,
      object_title: project.name,
      workspace_id: application.workspace_id,
      project_id: project.id,
      metadata: { profile_id: application.applicant_id },
    }).catch(console.error)
  }

  return NextResponse.json({ id: application.id, status: parsed.data.status })
}

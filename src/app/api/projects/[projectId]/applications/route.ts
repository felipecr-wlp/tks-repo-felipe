/**
 * POST /api/projects/[projectId]/applications: postularse a un proyecto abierto.
 * GET  /api/projects/[projectId]/applications: el lider/manager lista las postulaciones.
 *
 * Corazon de la nueva logica: la gente se POSTULA a proyectos abiertos en vez de
 * ser asignada. El lider del proyecto revisa y decide (ver PATCH en
 * /api/applications/[applicationId]).
 *
 * Admin client + verificacion en handler (evita IDOR).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, createNotification, ActivityVerbs, NotificationTypes } from '@/lib/activity'

const applySchema = z.object({
  pitch:        z.string().min(10).max(2000).trim(),
  role_desired: z.string().max(120).trim().nullable().optional(),
}).strict()

// ─── POST: postularse ─────────────────────────────────────────────────────────
export async function POST(
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

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = applySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()

  type ProjRow = {
    id: string; name: string; workspace_id: string; lead_id: string | null; created_by: string | null
    open_for_applications: boolean; application_deadline: string | null; is_archived: boolean
  }
  const { data: project } = await admin
    .from('projects')
    .select('id, name, workspace_id, lead_id, created_by, open_for_applications, application_deadline, is_archived')
    .eq('id', params.projectId)
    .maybeSingle() as { data: ProjRow | null; error: unknown }
  if (!project || project.is_archived) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })

  if (!project.open_for_applications) {
    return NextResponse.json({ error: 'Este proyecto no está abierto a postulaciones' }, { status: 409 })
  }
  if (project.application_deadline && new Date(project.application_deadline) < new Date()) {
    return NextResponse.json({ error: 'La fecha límite de postulación ya pasó' }, { status: 409 })
  }

  // Debe ser miembro del workspace del proyecto
  const { data: wsMember } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', project.workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { profile_id: string } | null }
  if (!wsMember) return NextResponse.json({ error: 'Sin acceso a este espacio de trabajo' }, { status: 403 })

  // Ya es miembro del proyecto -> no tiene sentido postular
  const { data: alreadyMember } = await admin
    .from('project_members')
    .select('profile_id')
    .eq('project_id', project.id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { profile_id: string } | null }
  if (alreadyMember) return NextResponse.json({ error: 'Ya eres miembro de este proyecto' }, { status: 409 })

  type AppResult = { id: string; status: string; created_at: string }
  const { data: application, error } = await admin
    .from('project_applications')
    .insert({
      project_id:   project.id,
      workspace_id: project.workspace_id,
      applicant_id: user.id,
      pitch:        parsed.data.pitch,
      role_desired: parsed.data.role_desired ?? null,
      status:       'pending',
    })
    .select('id, status, created_at')
    .single() as { data: AppResult | null; error: { code?: string } | null }

  if (error?.code === '23505') {
    return NextResponse.json({ error: 'Ya te postulaste a este proyecto' }, { status: 409 })
  }
  if (error || !application) {
    console.error('[applications POST] insert error:', error)
    return NextResponse.json({ error: 'Error al enviar la postulación' }, { status: 500 })
  }

  // Actividad + notificar al lider (o al creador si no hay lider)
  logActivity({
    verb: ActivityVerbs.APPLICATION_SUBMITTED,
    subject_id: user.id,
    object_type: 'project',
    object_id: project.id,
    object_title: project.name,
    workspace_id: project.workspace_id,
    project_id: project.id,
    metadata: { application_id: application.id },
  }).catch(console.error)

  const leadRecipient = project.lead_id ?? project.created_by
  if (leadRecipient && leadRecipient !== user.id) {
    createNotification({
      recipient_id: leadRecipient,
      subject_id: user.id,
      type: NotificationTypes.APPLICATION_SUBMITTED,
      object_type: 'project',
      object_id: project.id,
      object_title: project.name,
      workspace_id: project.workspace_id,
    }).catch(console.error)
  }

  return NextResponse.json(application, { status: 201 })
}

// ─── GET: el lider/manager lista las postulaciones del proyecto ────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  type ProjRow = { id: string; lead_id: string | null }
  const { data: project } = await admin
    .from('projects')
    .select('id, lead_id')
    .eq('id', params.projectId)
    .maybeSingle() as { data: ProjRow | null }
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })

  const [{ data: membership }, { data: profile }] = await Promise.all([
    admin.from('project_members').select('role').eq('project_id', params.projectId).eq('profile_id', user.id).maybeSingle() as Promise<{ data: { role: string } | null }>,
    admin.from('profiles').select('org_role').eq('id', user.id).maybeSingle() as Promise<{ data: { org_role: string } | null }>,
  ])
  const canReview = project.lead_id === user.id
    || membership?.role === 'manager'
    || profile?.org_role === 'owner' || profile?.org_role === 'admin'
  if (!canReview) return NextResponse.json({ error: 'Solo el lider o un manager pueden ver las postulaciones' }, { status: 403 })

  const { data: applications, error: applicationsError } = await admin
    .from('project_applications')
    .select('id, applicant_id, pitch, role_desired, status, decided_at, created_at, applicant:profiles!project_applications_applicant_id_fkey(id, display_name, avatar_url, email)')
    .eq('project_id', params.projectId)
    .order('created_at', { ascending: false }) as { data: unknown[] | null; error: unknown }

  if (applicationsError) {
    console.error('[project applications GET] read error:', applicationsError)
    return NextResponse.json({ error: 'Error al cargar postulaciones' }, { status: 500 })
  }

  return NextResponse.json({ applications: applications ?? [] })
}

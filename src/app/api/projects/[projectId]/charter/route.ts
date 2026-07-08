/**
 * PATCH /api/projects/[projectId]/charter
 * Edita el "charter" del proyecto: alcance, reglas, entregables, lider, y la
 * apertura a postulaciones (open_for_applications + deadline + cupo).
 *
 * Nueva logica de producto: no hay lideres organizacionales fijos. Cada proyecto
 * tiene su propio lider (projects.lead_id, por defecto = created_by) que define
 * las especificaciones y decide a quien acepta. Aqui el lider o un manager del
 * proyecto (u org owner/admin) publican esas reglas y abren el proyecto.
 *
 * Usa admin client (bypass RLS), asi que la autoridad se verifica en el handler
 * para no permitir que cualquiera edite el charter de un proyecto ajeno (IDOR).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'

const schema = z.object({
  scope:                 z.string().max(4000).trim().nullable().optional(),
  rules:                 z.string().max(4000).trim().nullable().optional(),
  deliverables:          z.string().max(4000).trim().nullable().optional(),
  lead_id:               z.string().uuid().nullable().optional(),
  open_for_applications: z.boolean().optional(),
  application_deadline:  z.string().datetime({ offset: true }).nullable().optional(),
  max_members:           z.number().int().min(1).max(200).nullable().optional(),
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

  // Cargar el proyecto (lead_id, workspace_id) para verificar autoridad
  type ProjRow = { id: string; name: string; workspace_id: string; lead_id: string | null; open_for_applications: boolean }
  const { data: project } = await admin
    .from('projects')
    .select('id, name, workspace_id, lead_id, open_for_applications')
    .eq('id', params.projectId)
    .maybeSingle() as { data: ProjRow | null; error: unknown }
  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })

  // Autoridad: lider del proyecto, manager del proyecto, u org owner/admin
  const [{ data: membership }, { data: profile }] = await Promise.all([
    admin.from('project_members').select('role').eq('project_id', params.projectId).eq('profile_id', user.id).maybeSingle() as Promise<{ data: { role: string } | null }>,
    admin.from('profiles').select('org_role').eq('id', user.id).maybeSingle() as Promise<{ data: { org_role: string } | null }>,
  ])
  const isLead    = project.lead_id === user.id
  const isManager = membership?.role === 'manager'
  const isOrgAdmin = profile?.org_role === 'owner' || profile?.org_role === 'admin'
  if (!isLead && !isManager && !isOrgAdmin) {
    return NextResponse.json({ error: 'Solo el lider o un manager pueden editar el charter' }, { status: 403 })
  }

  // Si se asigna un nuevo lider, debe ser miembro del proyecto
  if (parsed.data.lead_id) {
    const { data: leadMember } = await admin
      .from('project_members')
      .select('profile_id')
      .eq('project_id', params.projectId)
      .eq('profile_id', parsed.data.lead_id)
      .maybeSingle() as { data: { profile_id: string } | null }
    if (!leadMember) {
      return NextResponse.json({ error: 'El nuevo lider debe ser miembro del proyecto' }, { status: 422 })
    }
  }

  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() }

  type Updated = {
    id: string; scope: string | null; rules: string | null; deliverables: string | null
    lead_id: string | null; open_for_applications: boolean
    application_deadline: string | null; max_members: number | null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = await (admin as any)
    .from('projects')
    .update(patch)
    .eq('id', params.projectId)
    .select('id, scope, rules, deliverables, lead_id, open_for_applications, application_deadline, max_members')
    .single() as { data: Updated | null; error: unknown }

  if (error || !updated) {
    console.error('[charter PATCH] update error:', error)
    return NextResponse.json({ error: 'Error al guardar el charter' }, { status: 500 })
  }

  // Actividad: charter actualizado y, si cambio la apertura, abierto/cerrado
  logActivity({
    verb: ActivityVerbs.PROJECT_CHARTER_UPDATED,
    subject_id: user.id,
    object_type: 'project',
    object_id: project.id,
    object_title: project.name,
    workspace_id: project.workspace_id,
    project_id: project.id,
  }).catch(console.error)

  if (typeof parsed.data.open_for_applications === 'boolean'
      && parsed.data.open_for_applications !== project.open_for_applications) {
    logActivity({
      verb: parsed.data.open_for_applications ? ActivityVerbs.PROJECT_OPENED : ActivityVerbs.PROJECT_CLOSED,
      subject_id: user.id,
      object_type: 'project',
      object_id: project.id,
      object_title: project.name,
      workspace_id: project.workspace_id,
      project_id: project.id,
    }).catch(console.error)
  }

  return NextResponse.json(updated)
}

/**
 * POST /api/marketplace/propose
 * Cualquier miembro del workspace PROPONE un proyecto para el marketplace.
 *
 * Nueva logica de producto: todos pueden crear proyectos, pero SOLO los
 * administradores (org owner/admin) los autorizan. Por eso:
 *   - Propuesto por un admin  -> approval_status = 'approved' y abierto de una.
 *   - Propuesto por cualquiera -> approval_status = 'pending' y cerrado hasta que
 *     un admin lo apruebe (ahi se abre a postulaciones).
 *
 * El proponente queda como LIDER (lead_id) y manager del proyecto. No se agrega
 * al equipo completo: el marketplace se puebla via postulaciones, no por defecto.
 *
 * Admin client (bypass RLS) + verificacion de membresia en el handler (anti-IDOR).
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { slugify } from '@/lib/utils'
import { logActivity, createNotification, ActivityVerbs, NotificationTypes } from '@/lib/activity'

const schema = z.object({
  workspace_slug:       z.string().min(1).max(120),
  team_id:              z.string().uuid().nullable().optional(),
  name:                 z.string().min(2).max(80).trim(),
  description:          z.string().max(500).trim().nullable().optional(),
  icon:                 z.string().max(8).nullable().optional(),
  scope:                z.string().max(4000).trim().nullable().optional(),
  deliverables:         z.string().max(4000).trim().nullable().optional(),
  rules:                z.string().max(4000).trim().nullable().optional(),
  max_members:          z.number().int().min(1).max(200).nullable().optional(),
  application_deadline: z.string().datetime({ offset: true }).nullable().optional(),
}).strict()

export async function POST(request: NextRequest) {
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
  const d = parsed.data

  const admin = createAdminClient()

  // Workspace desde la membresia (anti-RLS-loop): el proponente debe pertenecer.
  type WsRow = { workspace_id: string; workspaces: { id: string; slug: string } | null }
  const { data: wsMember } = await admin
    .from('workspace_members')
    .select('workspace_id, workspaces!inner ( id, slug )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', d.workspace_slug)
    .limit(1)
    .maybeSingle() as { data: WsRow | null }
  const workspaceId = wsMember?.workspace_id
  if (!workspaceId) return NextResponse.json({ error: 'Sin acceso al workspace' }, { status: 403 })

  // Resolver equipo destino: el enviado (validando membresia) o el primero del usuario.
  let teamId = d.team_id ?? null
  if (teamId) {
    const { data: tm } = await admin
      .from('team_members')
      .select('team_id, teams!inner ( workspace_id )')
      .eq('profile_id', user.id)
      .eq('team_id', teamId)
      .eq('teams.workspace_id', workspaceId)
      .maybeSingle() as { data: { team_id: string } | null }
    if (!tm) return NextResponse.json({ error: 'No perteneces a ese equipo' }, { status: 403 })
  } else {
    const { data: firstTeam } = await admin
      .from('team_members')
      .select('team_id, teams!inner ( workspace_id )')
      .eq('profile_id', user.id)
      .eq('teams.workspace_id', workspaceId)
      .limit(1)
      .maybeSingle() as { data: { team_id: string } | null }
    teamId = firstTeam?.team_id ?? null
  }
  if (!teamId) return NextResponse.json({ error: 'No perteneces a ningun equipo de este workspace' }, { status: 422 })

  // ¿El proponente es administrador de la organizacion?
  const { data: profile } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', user.id)
    .maybeSingle() as { data: { org_role: string } | null }
  const isAdmin = profile?.org_role === 'owner' || profile?.org_role === 'admin'

  // Slug unico dentro del equipo.
  let slug = slugify(d.name)
  const { data: dupe } = await admin
    .from('projects')
    .select('slug')
    .eq('team_id', teamId)
    .eq('slug', slug)
    .maybeSingle() as { data: { slug: string } | null }
  if (dupe) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`

  const nowIso = new Date().toISOString()
  const approvalStatus = isAdmin ? 'approved' : 'pending'

  type ProjResult = { id: string; name: string; slug: string; icon: string | null; approval_status: string; open_for_applications: boolean }
  const { data: project, error: insertError } = await admin
    .from('projects')
    .insert({
      team_id: teamId,
      workspace_id: workspaceId,
      name: d.name,
      slug,
      description: d.description ?? null,
      icon: d.icon ?? null,
      scope: d.scope ?? null,
      deliverables: d.deliverables ?? null,
      rules: d.rules ?? null,
      max_members: d.max_members ?? null,
      application_deadline: d.application_deadline ?? null,
      status: 'active',
      created_by: user.id,
      lead_id: user.id,
      approval_status: approvalStatus,
      approved_by: isAdmin ? user.id : null,
      approved_at: isAdmin ? nowIso : null,
      open_for_applications: isAdmin, // aprobado por admin: abierto de una; pendiente: cerrado
    })
    .select('id, name, slug, icon, approval_status, open_for_applications')
    .single() as { data: ProjResult | null; error: unknown }

  if (insertError || !project) {
    console.error('[marketplace propose] insert error:', insertError)
    return NextResponse.json({ error: 'Error al crear el proyecto' }, { status: 500 })
  }

  // El proponente entra como manager (y es el lider).
  await admin
    .from('project_members')
    .upsert({ project_id: project.id, profile_id: user.id, role: 'manager', joined_at: nowIso }, { onConflict: 'project_id,profile_id' })

  // Statuses por defecto para que el tablero de tareas funcione desde el inicio.
  await admin.rpc('create_default_statuses', { p_project_id: project.id })

  logActivity({
    verb: isAdmin ? ActivityVerbs.PROJECT_CREATED : ActivityVerbs.PROJECT_PROPOSED,
    subject_id: user.id,
    object_type: 'project',
    object_id: project.id,
    object_title: project.name,
    workspace_id: workspaceId,
    project_id: project.id,
  }).catch(console.error)

  // Si quedo pendiente, avisar a los administradores para que lo revisen.
  if (!isAdmin) {
    const { data: admins } = await admin
      .from('profiles')
      .select('id')
      .in('org_role', ['owner', 'admin']) as { data: { id: string }[] | null }
    for (const a of admins ?? []) {
      if (a.id === user.id) continue
      createNotification({
        recipient_id: a.id,
        subject_id: user.id,
        type: NotificationTypes.PROJECT_PENDING_APPROVAL,
        object_type: 'project',
        object_id: project.id,
        object_title: project.name,
        workspace_id: workspaceId,
      }).catch(console.error)
    }
  }

  return NextResponse.json({
    id: project.id,
    slug: project.slug,
    approval_status: project.approval_status,
    open_for_applications: project.open_for_applications,
    pending: !isAdmin,
  }, { status: 201 })
}

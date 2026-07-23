/**
 * POST /api/projects, Crea un nuevo proyecto en un equipo.
 * Body: { team_id, name, description?, icon? }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { applyRateLimit } from '@/lib/rate-limit'
import { slugify } from '@/lib/utils'
import { logActivity, ActivityVerbs } from '@/lib/activity'
import { getProjectTemplate } from '@/lib/project-templates'

const schema = z.object({
  team_id:     z.string().uuid(),
  name:        z.string().min(2).max(80).trim(),
  description: z.string().max(500).trim().optional(),
  icon:        z.string().max(24).optional().default('clipboard'),
  template:    z.string().max(40).optional(),
})

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

  const { team_id, name, description, icon, template } = parsed.data

  const admin = createAdminClient()

  // Obtener workspace_id del equipo
  type TeamRow = { workspace_id: string }
  const { data: team } = await admin
    .from('teams')
    .select('workspace_id')
    .eq('id', team_id)
    .maybeSingle() as { data: TeamRow | null; error: unknown }
  if (!team) return NextResponse.json({ error: 'Equipo no encontrado' }, { status: 404 })

  // Acceso: miembro del equipo O admin del workspace. El sidebar les muestra a
  // los admins todos los equipos (con su botón "Nuevo proyecto"), así que la
  // creación debe permitirse aunque el admin no sea miembro del equipo.
  const { data: teamMembership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', team_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!teamMembership) {
    const adminCtx = await isWorkspaceAdminById(team.workspace_id)
    if (!adminCtx?.isAdmin) {
      return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })
    }
  }

  // Generar slug único
  let slug = slugify(name)
  type SlugCheck = { slug: string }
  const { data: existing } = await admin
    .from('projects')
    .select('slug')
    .eq('team_id', team_id)
    .eq('slug', slug)
    .maybeSingle() as { data: SlugCheck | null; error: unknown }
  if (existing) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`

  // Crear proyecto
  type ProjectResult = { id: string; name: string; slug: string; icon: string | null }
  const { data: project, error: insertError } = await admin
    .from('projects')
    .insert({
      team_id,
      workspace_id: team.workspace_id,
      name,
      slug,
      description: description ?? null,
      icon: icon ?? 'clipboard',
      status: 'active',
      created_by: user.id,
    })
    .select('id, name, slug, icon')
    .single() as { data: ProjectResult | null; error: unknown }

  if (insertError || !project) {
    console.error('[projects POST] insert error:', insertError)
    return NextResponse.json({ error: 'Error al crear el proyecto' }, { status: 500 })
  }

  // Membresía automática: agregar a TODO el equipo al proyecto para que las
  // tareas/actividad sean visibles entre usuarios (el creador queda como manager,
  // el resto como members). Esto cierra el hueco de visibilidad del sidebar, que
  // filtra proyectos por project_members.
  type TeamMemberRow = { profile_id: string }
  const { data: teamMembers } = await admin
    .from('team_members')
    .select('profile_id')
    .eq('team_id', team_id) as { data: TeamMemberRow[] | null; error: unknown }

  const memberRows = (teamMembers ?? []).map(m => ({
    project_id: project.id,
    profile_id: m.profile_id,
    role: m.profile_id === user.id ? 'manager' : 'member',
  }))
  // Garantizar que el creador siempre esté aunque no aparezca en team_members
  if (!memberRows.some(r => r.profile_id === user.id)) {
    memberRows.push({ project_id: project.id, profile_id: user.id, role: 'manager' })
  }

  await admin
    .from('project_members')
    .upsert(memberRows, { onConflict: 'project_id,profile_id' })

  // Crear statuses por defecto
  await admin.rpc('create_default_statuses', { p_project_id: project.id })

  // ─── Siembra de plantilla (opcional) ─────────────────────────────────────────
  // Si el proyecto se creó desde una plantilla (ej. "Obra de pavimentación"),
  // sembramos el flujo de tareas en el primer status "por hacer" y los campos
  // personalizados de la obra. Best-effort: si algo falla, el proyecto ya existe
  // y no bloqueamos la respuesta.
  const tpl = getProjectTemplate(template)
  if (tpl) {
    try {
      const db = admin

      // Status inicial (posición 0, categoría todo)
      type StatusRow = { id: string }
      const { data: firstStatus } = await db
        .from('task_statuses')
        .select('id')
        .eq('project_id', project.id)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle() as { data: StatusRow | null }

      // Tareas: sort_order encadenado con fractional-indexing
      if (tpl.tasks.length > 0) {
        const { generateKeyBetween } = await import('fractional-indexing')
        let prevKey: string | null = null
        const taskRows = tpl.tasks.map(t => {
          const key = generateKeyBetween(prevKey, null)
          prevKey = key
          return {
            project_id: project.id,
            workspace_id: team.workspace_id,
            title: t.title,
            description: t.description ?? null,
            status_id: firstStatus?.id ?? null,
            priority: t.priority ?? 'none',
            created_by: user.id,
            sort_order: key,
          }
        })
        await db.from('tasks').insert(taskRows)
      }

      // Campos personalizados de la obra
      if (tpl.fields.length > 0) {
        const fieldRows = tpl.fields.map((f, i) => ({
          project_id: project.id,
          workspace_id: team.workspace_id,
          name: f.name,
          field_type: f.field_type,
          options: f.options ?? [],
          position: i,
          created_by: user.id,
        }))
        await db.from('custom_field_definitions').insert(fieldRows)
      }
    } catch (seedErr) {
      console.error('[projects POST] template seed error:', seedErr)
    }
  }

  logActivity({
    verb: ActivityVerbs.PROJECT_CREATED,
    subject_id: user.id,
    object_type: 'project',
    object_id: project.id,
    object_title: project.name,
    workspace_id: team.workspace_id,
    project_id: project.id,
  }).catch(console.error)

  return NextResponse.json(project, { status: 201 })
}

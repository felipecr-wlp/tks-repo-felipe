/**
 * POST /api/teams, Crea un equipo en un workspace.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isWorkspaceAdminById } from '@/lib/workspace-admin'
import { applyRateLimit } from '@/lib/rate-limit'
import { slugify } from '@/lib/utils'

const schema = z.object({
  workspace_id: z.string().uuid(),
  name:         z.string().min(2).max(80).trim(),
  description:  z.string().max(300).trim().optional(),
  // Departamento (space) al que pertenece el equipo. Opcional: null = equipo
  // suelto a nivel workspace (comportamiento legacy).
  space_id:     z.string().uuid().nullable().optional(),
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

  const { workspace_id, name, description, space_id } = parsed.data

  const admin = createAdminClient()

  // Solo los administradores del workspace pueden crear equipos. Los miembros
  // regulares no pueden generarlos: la asignación de equipos es potestad del admin.
  const adminCtx = await isWorkspaceAdminById(workspace_id)
  if (!adminCtx?.isAdmin) {
    return NextResponse.json({ error: 'Solo un administrador puede crear equipos' }, { status: 403 })
  }

  // Si se asigna departamento, debe vivir en el MISMO workspace (coherencia con
  // la FK compuesta teams_space_workspace_fkey y con el aislamiento por depto).
  if (space_id) {
    const { data: dept } = await admin
      .from('spaces')
      .select('id')
      .eq('id', space_id)
      .eq('workspace_id', workspace_id)
      .maybeSingle() as { data: { id: string } | null; error: unknown }
    if (!dept) {
      return NextResponse.json({ error: 'El departamento no pertenece a este workspace' }, { status: 422 })
    }
  }

  // Generar slug único dentro del workspace
  let slug = slugify(name)
  type SlugCheck = { slug: string }
  const { data: existing } = await admin
    .from('teams')
    .select('slug')
    .eq('workspace_id', workspace_id)
    .eq('slug', slug)
    .maybeSingle() as { data: SlugCheck | null; error: unknown }
  if (existing) slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`

  type TeamResult = { id: string; name: string; slug: string }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: team, error: insertError } = await (admin as any)
    .from('teams')
    .insert({
      workspace_id,
      name,
      slug,
      description: description ?? null,
      space_id: space_id ?? null,
      created_by: user.id,
    })
    .select('id, name, slug')
    .single() as { data: TeamResult | null; error: unknown }

  if (insertError || !team) {
    console.error('[teams POST] insert error:', insertError)
    return NextResponse.json({ error: 'Error al crear el equipo' }, { status: 500 })
  }

  // Agregar al creador como admin del equipo
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any)
    .from('team_members')
    .insert({ team_id: team.id, profile_id: user.id, role: 'admin' })

  return NextResponse.json(team, { status: 201 })
}

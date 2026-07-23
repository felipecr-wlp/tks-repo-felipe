/**
 * GET  /api/projects/[projectId]/custom-fields, lista las definiciones de campos
 *      personalizados del proyecto (ordenadas por position).
 * POST /api/projects/[projectId]/custom-fields, crea una definicion nueva.
 *
 * Campos personalizados = paridad ClickUp/Jira. Tipos: text, number, currency,
 * date, checkbox, url, select, multi_select. Los (multi_)select llevan opciones.
 *
 * Anti-IDOR: projectId viene de la ruta y se valida por membresia del proyecto
 * (el admin client ignora RLS). created_by se toma del usuario autenticado.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { projectId: string }
}

const FIELD_TYPES = ['text', 'number', 'currency', 'date', 'checkbox', 'url', 'select', 'multi_select'] as const

const optionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  color: z.string().max(16).optional(),
})

const createSchema = z.object({
  name: z.string().min(1).max(80),
  field_type: z.enum(FIELD_TYPES),
  options: z.array(optionSchema).max(50).optional(),
})

async function assertMember(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  userId: string,
): Promise<{ ok: boolean; workspaceId: string | null }> {
  const { data: proj } = await admin
    .from('projects')
    .select('id, workspace_id')
    .eq('id', projectId)
    .maybeSingle() as { data: { id: string; workspace_id: string } | null }
  if (!proj) return { ok: false, workspaceId: null }

  const { data: pm } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null }
  if (pm) return { ok: true, workspaceId: proj.workspace_id }

  // fallback: miembro del workspace del proyecto
  const { data: wm } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', proj.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null }
  return { ok: !!wm, workspaceId: proj.workspace_id }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const access = await assertMember(admin, params.projectId, user.id)
  if (!access.ok) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const { data } = await admin
    .from('custom_field_definitions')
    .select('id, name, field_type, options, position, created_at')
    .eq('project_id', params.projectId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  return NextResponse.json({ fields: data ?? [] })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const access = await assertMember(admin, params.projectId, user.id)
  if (!access.ok) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos', detail: parsed.error.flatten() }, { status: 400 })
  }
  const { name, field_type } = parsed.data
  const isSelect = field_type === 'select' || field_type === 'multi_select'
  const options = isSelect ? (parsed.data.options ?? []) : []

  // position = al final
  const { data: last } = await admin
    .from('custom_field_definitions')
    .select('position')
    .eq('project_id', params.projectId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: { position: number } | null }
  const position = (last?.position ?? -1) + 1

  const db = admin
  const { data, error } = await db
    .from('custom_field_definitions')
    .insert({
      project_id: params.projectId,
      workspace_id: access.workspaceId,
      name,
      field_type,
      options,
      position,
      created_by: user.id,
    })
    .select('id, name, field_type, options, position, created_at')
    .single()

  if (error) {
    console.error('[custom-fields POST] insert error:', error)
    return NextResponse.json({ error: 'Error al crear el campo' }, { status: 500 })
  }
  return NextResponse.json({ field: data }, { status: 201 })
}

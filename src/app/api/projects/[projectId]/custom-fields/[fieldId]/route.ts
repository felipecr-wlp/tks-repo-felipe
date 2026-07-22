/**
 * PATCH  /api/projects/[projectId]/custom-fields/[fieldId], edita una definicion
 *        (renombrar, reordenar, editar opciones de (multi_)select).
 * DELETE /api/projects/[projectId]/custom-fields/[fieldId], borra la definicion
 *        (CASCADE elimina todos sus valores en task_custom_field_values).
 *
 * Anti-IDOR: se valida membresia del proyecto y que el campo pertenezca al
 * proyecto de la ruta (el admin client ignora RLS).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { projectId: string; fieldId: string }
}

const optionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  color: z.string().max(16).optional(),
})

const patchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  position: z.number().int().min(0).max(1000).optional(),
  options: z.array(optionSchema).max(50).optional(),
})

async function assertMember(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const { data: pm } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null }
  if (pm) return true

  const { data: proj } = await admin
    .from('projects')
    .select('workspace_id')
    .eq('id', projectId)
    .maybeSingle() as { data: { workspace_id: string } | null }
  if (!proj) return false

  const { data: wm } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', proj.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null }
  return !!wm
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.projectId) || !isUuid(params.fieldId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await assertMember(admin, params.projectId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos', detail: parsed.error.flatten() }, { status: 400 })
  }

  // el campo debe pertenecer al proyecto de la ruta
  const { data: field } = await admin
    .from('custom_field_definitions')
    .select('id, project_id')
    .eq('id', params.fieldId)
    .maybeSingle() as { data: { id: string; project_id: string } | null }
  if (!field || field.project_id !== params.projectId) {
    return NextResponse.json({ error: 'Campo no encontrado' }, { status: 404 })
  }

  const patch: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) patch.name = parsed.data.name
  if (parsed.data.position !== undefined) patch.position = parsed.data.position
  if (parsed.data.options !== undefined) patch.options = parsed.data.options
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any
  const { data, error } = await db
    .from('custom_field_definitions')
    .update(patch)
    .eq('id', params.fieldId)
    .select('id, name, field_type, options, position, created_at')
    .single()

  if (error) {
    console.error('[custom-fields PATCH] update error:', error)
    return NextResponse.json({ error: 'Error al actualizar el campo' }, { status: 500 })
  }
  return NextResponse.json({ field: data })
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.projectId) || !isUuid(params.fieldId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  if (!(await assertMember(admin, params.projectId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const { data: field } = await admin
    .from('custom_field_definitions')
    .select('id, project_id')
    .eq('id', params.fieldId)
    .maybeSingle() as { data: { id: string; project_id: string } | null }
  if (!field || field.project_id !== params.projectId) {
    return NextResponse.json({ error: 'Campo no encontrado' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any
  const { error } = await db
    .from('custom_field_definitions')
    .delete()
    .eq('id', params.fieldId)

  if (error) {
    console.error('[custom-fields DELETE] delete error:', error)
    return NextResponse.json({ error: 'Error al borrar el campo' }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}

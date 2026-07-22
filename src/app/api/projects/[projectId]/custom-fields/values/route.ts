/**
 * GET /api/projects/[projectId]/custom-fields/values, devuelve las definiciones
 * de campos personalizados del proyecto MAS un mapa de valores por tarea, en una
 * sola llamada. Sirve a la vista de lista para pintar los campos sin hacer N
 * fetches (uno por tarea).
 *
 * Respuesta:
 *   { fields: CustomFieldDef[], values: { [taskId]: { [fieldId]: value } } }
 *
 * Anti-IDOR: projectId viene de la ruta y se valida por membresia (admin client
 * ignora RLS). Los valores se filtran por project_id, no se cruza otro proyecto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { projectId: string }
}

async function assertMember(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  userId: string,
): Promise<boolean> {
  const { data: proj } = await admin
    .from('projects')
    .select('id, workspace_id')
    .eq('id', projectId)
    .maybeSingle() as { data: { id: string; workspace_id: string } | null }
  if (!proj) return false

  const { data: pm } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null }
  if (pm) return true

  const { data: wm } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', proj.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null }
  return !!wm
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
  const ok = await assertMember(admin, params.projectId, user.id)
  if (!ok) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const { data: fields, error: fieldsError } = await admin
    .from('custom_field_definitions')
    .select('id, name, field_type, options, position, created_at')
    .eq('project_id', params.projectId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (fieldsError) {
    console.error('[custom-fields values GET] fields read error:', fieldsError)
    return NextResponse.json({ error: 'Error al cargar campos personalizados' }, { status: 500 })
  }

  const { data: rows, error: rowsError } = await admin
    .from('task_custom_field_values')
    .select('task_id, field_id, value')
    .eq('project_id', params.projectId) as {
      data: { task_id: string; field_id: string; value: unknown }[] | null; error: unknown
    }

  if (rowsError) {
    console.error('[custom-fields values GET] values read error:', rowsError)
    return NextResponse.json({ error: 'Error al cargar campos personalizados' }, { status: 500 })
  }

  const values: Record<string, Record<string, unknown>> = {}
  for (const r of rows ?? []) {
    if (!values[r.task_id]) values[r.task_id] = {}
    values[r.task_id][r.field_id] = r.value
  }

  return NextResponse.json({ fields: fields ?? [], values })
}

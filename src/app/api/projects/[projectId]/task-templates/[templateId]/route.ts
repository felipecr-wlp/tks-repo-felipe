/**
 * DELETE /api/projects/[projectId]/task-templates/[templateId], borra una
 * plantilla de tarea.
 *
 * Solo puede borrarla su creador o un manager del proyecto. Anti-IDOR: valida
 * membresia del proyecto y ademas que la plantilla pertenezca a este proyecto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { projectId: string; templateId: string }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.projectId) || !isUuid(params.templateId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', params.projectId)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Cargar la plantilla (acotada al proyecto de la ruta) para validar existencia
  // y permiso fino antes de borrar.
  type TemplateRow = { id: string; created_by: string | null }
  const { data: template } = await admin
    .from('task_templates')
    .select('id, created_by')
    .eq('id', params.templateId)
    .eq('project_id', params.projectId)
    .maybeSingle() as { data: TemplateRow | null; error: unknown }

  if (!template) return NextResponse.json({ error: 'Plantilla no encontrada' }, { status: 404 })

  // Permiso: el creador o un manager del proyecto.
  const isCreator = template.created_by === user.id
  const isManager = membership.role === 'manager'
  if (!isCreator && !isManager) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('task_templates')
    .delete()
    .eq('id', params.templateId)
    .eq('project_id', params.projectId)

  if (error) {
    console.error('[task-templates DELETE] error:', error)
    return NextResponse.json({ error: 'Error al borrar la plantilla' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

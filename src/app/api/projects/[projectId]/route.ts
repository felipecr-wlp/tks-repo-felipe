/**
 * PATCH /api/projects/[projectId], Actualiza nombre, descripción, icono, estado.
 * DELETE /api/projects/[projectId], Archiva el proyecto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canManageProject } from '@/lib/team-access'

const patchSchema = z.object({
  name:        z.string().min(2).max(80).trim().optional(),
  description: z.string().max(500).trim().nullable().optional(),
  icon:        z.string().max(24).nullable().optional(),
  status:      z.enum(['active', 'on_hold', 'archived']).optional(),
}).strict()

export async function PATCH(
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

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()

  // Permiso amplio: manager/lead/admin/owner del proyecto, o admin/owner del workspace u org
  const { ok } = await canManageProject(admin, params.projectId, user.id)
  if (!ok) {
    return NextResponse.json({ error: 'Se requiere rol manager o admin' }, { status: 403 })
  }

  type ProjResult = { id: string; name: string; slug: string; icon: string | null; status: string }
  const { data: updated, error } = await admin
    .from('projects')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.projectId)
    .select('id, name, slug, icon, status')
    .single() as { data: ProjResult | null; error: unknown }

  if (error || !updated) return NextResponse.json({ error: 'Error al actualizar' }, { status: 500 })
  return NextResponse.json(updated)
}

export async function DELETE(
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

  const admin = createAdminClient()

  const { ok } = await canManageProject(admin, params.projectId, user.id)
  if (!ok) {
    return NextResponse.json({ error: 'Se requiere rol manager o admin' }, { status: 403 })
  }

  // Soft delete, archivar el proyecto
  const { error } = await admin
    .from('projects')
    .update({ is_archived: true, status: 'archived', updated_at: new Date().toISOString() })
    .eq('id', params.projectId)

  if (error) return NextResponse.json({ error: 'Error al archivar' }, { status: 500 })
  return NextResponse.json({ success: true })
}

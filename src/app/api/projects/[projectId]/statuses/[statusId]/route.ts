/**
 * PATCH  /api/projects/[projectId]/statuses/[statusId], Edita un estado (nombre/color/categoria).
 * DELETE /api/projects/[projectId]/statuses/[statusId], Elimina un estado.
 *
 * Mismo gateo que la ruta padre (administradores del proyecto/workspace/org).
 * Anti-IDOR: el estado debe pertenecer al proyecto de la URL.
 *
 * DELETE: el FK tasks.status_id es ON DELETE SET NULL, asi que borrar no rompe
 * las tareas, pero las dejaria SIN estado en silencio. Por eso, estilo Jira, se
 * BLOQUEA (409) si hay tareas usando el estado y se pide moverlas primero. Ademas
 * no se permite borrar el ultimo estado del proyecto.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canManageProject } from '@/lib/team-access'

const HEX = /^#[0-9a-fA-F]{6}$/
const CATEGORIES = ['todo', 'in_progress', 'done', 'cancelled'] as const

const patchSchema = z.object({
  name:     z.string().min(1).max(40).trim().optional(),
  color:    z.string().regex(HEX, 'Color hex invalido').optional(),
  category: z.enum(CATEGORIES).optional(),
}).strict().refine(d => Object.keys(d).length > 0, { message: 'Nada que actualizar' })

async function guard(projectId: string, statusId: string, userId: string) {
  const admin = createAdminClient()
  const { ok } = await canManageProject(admin, projectId, userId)
  if (!ok) return { admin, error: NextResponse.json({ error: 'Sin acceso' }, { status: 403 }) }

  const { data: status } = await admin
    .from('task_statuses')
    .select('id')
    .eq('id', statusId)
    .eq('project_id', projectId)
    .maybeSingle() as { data: { id: string } | null }
  if (!status) return { admin, error: NextResponse.json({ error: 'Estado no encontrado' }, { status: 404 }) }

  return { admin, error: null }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string; statusId: string } }
) {
  if (!isUuid(params.projectId) || !isUuid(params.statusId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = patchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { admin, error } = await guard(params.projectId, params.statusId, user.id)
  if (error) return error

  const { data: status, error: updErr } = await admin
    .from('task_statuses')
    .update(parsed.data)
    .eq('id', params.statusId)
    .eq('project_id', params.projectId)
    .select('id, name, color, category, position')
    .single()

  if (updErr || !status) {
    console.error('[statuses PATCH] update error:', updErr)
    return NextResponse.json({ error: 'Error al actualizar el estado' }, { status: 500 })
  }

  return NextResponse.json(status)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string; statusId: string } }
) {
  if (!isUuid(params.projectId) || !isUuid(params.statusId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { admin, error } = await guard(params.projectId, params.statusId, user.id)
  if (error) return error

  // No dejar el proyecto sin ningun estado.
  const { count: total } = await admin
    .from('task_statuses')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', params.projectId)
  if ((total ?? 0) <= 1) {
    return NextResponse.json({ error: 'El proyecto debe conservar al menos un estado' }, { status: 409 })
  }

  // Bloquear si hay tareas usando el estado (evita dejarlas sin estado en silencio).
  const { count: inUse } = await admin
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('status_id', params.statusId)
  if ((inUse ?? 0) > 0) {
    return NextResponse.json(
      { error: `Hay ${inUse} tarea(s) en este estado. Muévelas a otro estado antes de eliminarlo.`, in_use: inUse },
      { status: 409 }
    )
  }

  const { error: delErr } = await admin
    .from('task_statuses')
    .delete()
    .eq('id', params.statusId)
    .eq('project_id', params.projectId)

  if (delErr) {
    console.error('[statuses DELETE] delete error:', delErr)
    return NextResponse.json({ error: 'Error al eliminar el estado' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

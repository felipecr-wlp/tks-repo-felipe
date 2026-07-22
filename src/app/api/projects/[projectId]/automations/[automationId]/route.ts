/**
 * PATCH  /api/projects/[projectId]/automations/[automationId], Edita una regla.
 * DELETE /api/projects/[projectId]/automations/[automationId], Elimina una regla.
 *
 * Mismo gateo que la ruta padre (administradores del proyecto/workspace/org).
 * Anti-IDOR: la regla debe pertenecer al proyecto de la URL.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canManageProject } from '@/lib/team-access'
import { AUTOMATION_TRIGGERS, AUTOMATION_ACTION_TYPES } from '@/lib/automations'

const conditionSchema = z.object({
  field: z.enum(['priority', 'assignee_id', 'status_id']),
  op:    z.enum(['eq', 'neq']),
  value: z.string().nullable(),
})
const actionSchema = z.object({
  type:        z.enum(AUTOMATION_ACTION_TYPES as [string, ...string[]]),
  assignee_id: z.string().uuid().nullable().optional(),
  status_id:   z.string().uuid().nullable().optional(),
  sprint_id:   z.string().uuid().nullable().optional(),
  recipient_id: z.string().max(60).optional(),
  body:        z.string().max(4000).optional(),
})
const triggerConfigSchema = z.object({
  to_status_id:   z.string().uuid().optional(),
  to_assignee_id: z.string().uuid().optional(),
})

const patchSchema = z.object({
  name:           z.string().min(1).max(120).trim().optional(),
  trigger:        z.enum(AUTOMATION_TRIGGERS as [string, ...string[]]).optional(),
  trigger_config: triggerConfigSchema.optional(),
  conditions:     z.array(conditionSchema).max(10).optional(),
  actions:        z.array(actionSchema).min(1).max(10).optional(),
  is_active:      z.boolean().optional(),
}).strict()

async function guard(projectId: string, automationId: string, userId: string) {
  const admin = createAdminClient()
  const { ok } = await canManageProject(admin, projectId, userId)
  if (!ok) return { admin, error: NextResponse.json({ error: 'Sin acceso' }, { status: 403 }) }

  const { data: rule } = await admin
    .from('automations')
    .select('id')
    .eq('id', automationId)
    .eq('project_id', projectId)
    .maybeSingle() as { data: { id: string } | null }
  if (!rule) return { admin, error: NextResponse.json({ error: 'Regla no encontrada' }, { status: 404 }) }

  return { admin, error: null }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { projectId: string; automationId: string } }
) {
  if (!isUuid(params.projectId) || !isUuid(params.automationId)) {
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

  const { admin, error } = await guard(params.projectId, params.automationId, user.id)
  if (error) return error

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rule, error: updErr } = await (admin as any)
    .from('automations')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.automationId)
    .select('id, name, trigger, trigger_config, conditions, actions, is_active, created_at')
    .single()

  if (updErr || !rule) {
    console.error('[automations PATCH] update error:', updErr)
    return NextResponse.json({ error: 'Error al actualizar la regla' }, { status: 500 })
  }

  return NextResponse.json(rule)
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { projectId: string; automationId: string } }
) {
  if (!isUuid(params.projectId) || !isUuid(params.automationId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { admin, error } = await guard(params.projectId, params.automationId, user.id)
  if (error) return error

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: delErr } = await (admin as any)
    .from('automations')
    .delete()
    .eq('id', params.automationId)

  if (delErr) {
    console.error('[automations DELETE] delete error:', delErr)
    return NextResponse.json({ error: 'Error al eliminar la regla' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

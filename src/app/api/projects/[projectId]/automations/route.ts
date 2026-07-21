/**
 * GET  /api/projects/[projectId]/automations, Lista las reglas del proyecto.
 * POST /api/projects/[projectId]/automations, Crea una regla nueva.
 *
 * Motor de automatizaciones (Circuito 3.C). Solo administradores del proyecto
 * (manager/lead/admin/owner) o admins del workspace/org pueden ver y crear
 * reglas. Toda escritura pasa por el admin client tras el gateo (anti-IDOR:
 * project_id viene de la ruta, workspace_id se deriva del proyecto).
 */
import { NextRequest, NextResponse } from 'next/server'
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
  recipient_id: z.string().max(60).optional(), // 'assignee' o un uuid
  body:        z.string().max(4000).optional(),
})

const triggerConfigSchema = z.object({
  to_status_id:   z.string().uuid().optional(),
  to_assignee_id: z.string().uuid().optional(),
})

const createSchema = z.object({
  name:           z.string().min(1).max(120).trim().default('Regla'),
  trigger:        z.enum(AUTOMATION_TRIGGERS as [string, ...string[]]),
  trigger_config: triggerConfigSchema.optional().default({}),
  conditions:     z.array(conditionSchema).max(10).optional().default([]),
  actions:        z.array(actionSchema).min(1).max(10),
  is_active:      z.boolean().optional().default(true),
}).strict()

export async function GET(
  _request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { ok } = await canManageProject(admin, params.projectId, user.id)
  if (!ok) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const { data: rules } = await admin
    .from('automations')
    .select('id, name, trigger, trigger_config, conditions, actions, is_active, created_at')
    .eq('project_id', params.projectId)
    .order('created_at', { ascending: true })

  return NextResponse.json(rules ?? [])
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } }
) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = createSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()
  const { ok, workspaceId } = await canManageProject(admin, params.projectId, user.id)
  if (!ok || !workspaceId) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rule, error } = await (admin as any)
    .from('automations')
    .insert({
      workspace_id:   workspaceId,
      project_id:     params.projectId,
      name:           parsed.data.name,
      trigger:        parsed.data.trigger,
      trigger_config: parsed.data.trigger_config,
      conditions:     parsed.data.conditions,
      actions:        parsed.data.actions,
      is_active:      parsed.data.is_active,
      created_by:     user.id,
    })
    .select('id, name, trigger, trigger_config, conditions, actions, is_active, created_at')
    .single()

  if (error || !rule) {
    console.error('[automations POST] insert error:', error)
    return NextResponse.json({ error: 'Error al crear la regla' }, { status: 500 })
  }

  return NextResponse.json(rule, { status: 201 })
}

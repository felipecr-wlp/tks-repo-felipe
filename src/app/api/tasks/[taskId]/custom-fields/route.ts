/**
 * GET  /api/tasks/[taskId]/custom-fields, devuelve las definiciones de campos
 *      personalizados del proyecto de la tarea, cada una con su valor actual
 *      para ESTA tarea (o null si no hay valor).
 * POST /api/tasks/[taskId]/custom-fields, hace upsert del valor de un campo para
 *      la tarea (UNIQUE(field_id, task_id)). Body: { field_id, value }.
 *
 * Anti-IDOR: checkTaskAccess valida membresia del proyecto de la tarea (el admin
 * client ignora RLS). El field_id debe pertenecer al mismo proyecto de la tarea.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { checkTaskAccess } from '@/lib/task-access'

interface RouteParams {
  params: { taskId: string }
}

// value acepta string | number | boolean | array de option ids | null.
// El array se ACOTA (.max(100)): un multi_select sin techo dejaria que el
// cliente mande millones de ids (todos "validos" si repiten una option real,
// isValueValidForType no cuenta ni deduplica) y los vuelque al JSON del valor,
// saturando memoria y fila (OWASP API4, consumo de recursos no acotado).
const valueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()).max(100),
  z.null(),
])

const upsertSchema = z.object({
  field_id: z.string().uuid(),
  value: valueSchema,
})

interface FieldOptionDef { id: string; label?: string; color?: string }

/**
 * Valida un valor entrante contra el field_type de su definicion.
 * Devuelve true si es valido (null/vacio siempre es valido: limpia el campo).
 */
function isValueValidForType(
  fieldType: string,
  options: unknown,
  value: unknown,
): boolean {
  // null limpia el valor, valido para todos los tipos
  if (value === null) return true

  switch (fieldType) {
    case 'number':
    case 'currency':
      return typeof value === 'number' && Number.isFinite(value)

    case 'date': {
      if (typeof value !== 'string') return false
      const t = Date.parse(value)
      return !Number.isNaN(t)
    }

    case 'checkbox':
      return typeof value === 'boolean'

    case 'select': {
      if (typeof value !== 'string') return false
      if (value === '') return true
      const opts = Array.isArray(options) ? (options as FieldOptionDef[]) : []
      return opts.some((o) => o && o.id === value)
    }

    case 'multi_select': {
      if (!Array.isArray(value)) return false
      const opts = Array.isArray(options) ? (options as FieldOptionDef[]) : []
      const valid = new Set(opts.map((o) => o && o.id))
      return value.every((v) => typeof v === 'string' && valid.has(v))
    }

    case 'url': {
      if (typeof value !== 'string') return false
      if (value === '') return true
      if (value.length > 2048) return false
      try {
        const u = new URL(value)
        return u.protocol === 'http:' || u.protocol === 'https:'
      } catch {
        return false
      }
    }

    case 'text':
      return typeof value === 'string' && value.length <= 5000

    default:
      return false
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: access.status })
  }

  const { data: defs } = await admin
    .from('custom_field_definitions')
    .select('id, name, field_type, options, position, created_at')
    .eq('project_id', access.projectId!)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true }) as {
      data: Array<{ id: string; name: string; field_type: string; options: unknown; position: number; created_at: string }> | null
    }

  const { data: values } = await admin
    .from('task_custom_field_values')
    .select('field_id, value')
    .eq('task_id', params.taskId) as {
      data: Array<{ field_id: string; value: unknown }> | null
    }

  const valueMap = new Map((values ?? []).map((v) => [v.field_id, v.value]))
  const fields = (defs ?? []).map((d) => ({
    ...d,
    value: valueMap.has(d.id) ? valueMap.get(d.id) : null,
  }))

  return NextResponse.json({ fields })
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.taskId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const access = await checkTaskAccess(admin, params.taskId, user.id)
  if (!access.ok) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: access.status })
  }

  const body = await request.json().catch(() => null)
  const parsed = upsertSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos invalidos', detail: parsed.error.flatten() }, { status: 400 })
  }

  // el campo debe existir y pertenecer al proyecto de la tarea
  const { data: field } = await admin
    .from('custom_field_definitions')
    .select('id, project_id, field_type, options')
    .eq('id', parsed.data.field_id)
    .maybeSingle() as { data: { id: string; project_id: string; field_type: string; options: unknown } | null }
  if (!field || field.project_id !== access.projectId) {
    return NextResponse.json({ error: 'Campo no encontrado' }, { status: 404 })
  }

  // el valor debe corresponder al tipo del campo (evita corromper datos)
  if (!isValueValidForType(field.field_type, field.options, parsed.data.value)) {
    return NextResponse.json({ error: 'Valor inválido para el tipo de campo' }, { status: 422 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any
  const { data, error } = await db
    .from('task_custom_field_values')
    .upsert(
      {
        field_id: parsed.data.field_id,
        task_id: params.taskId,
        project_id: access.projectId,
        value: parsed.data.value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'field_id,task_id' },
    )
    .select('field_id, value')
    .single()

  if (error) {
    console.error('[task custom-fields POST] upsert error:', error)
    return NextResponse.json({ error: 'Error al guardar el valor' }, { status: 500 })
  }
  return NextResponse.json({ value: data })
}

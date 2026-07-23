/**
 * POST /api/projects/[projectId]/import
 *
 * Portabilidad de datos (contraparte de escritura del export): importa tareas a
 * un proyecto a partir de filas ya estructuradas por el cliente. El navegador
 * parsea el CSV y manda JSON { rows: [{ title, status?, priority?, due_date? }] };
 * esta ruta NO recibe un archivo crudo (menos superficie de ataque, sin parseo
 * de multipart en el servidor).
 *
 * Seguridad (mismo patron que el export hermano):
 *   - projectId validado como UUID, auth obligatorio (401), rate limit.
 *   - Anti-IDOR: el admin client bypassa RLS, por eso se carga primero el
 *     proyecto para obtener su workspace_id y luego se RE-VERIFICA que el
 *     usuario sea MIEMBRO de ese workspace via workspace_members antes de
 *     escribir nada. El projectId viene de la ruta, nunca del body.
 *   - Envelope zod .strict(); tope duro de 500 filas por lote para evitar abuso.
 *   - Insercion en una sola llamada (todo o nada) tras validar el lote completo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

// Tope duro de filas por lote (anti abuso). El cliente debe partir CSVs grandes.
const MAX_ROWS = 500

const rowSchema = z.object({
  title: z.string().min(1).max(500).trim(),
  status: z.string().trim().max(200).optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low', 'none']).optional(),
  // Fecha ISO (date o datetime). Se normaliza a ISO datetime al insertar.
  due_date: z.string().trim().min(1).max(40).optional(),
}).strict()

const importSchema = z.object({
  rows: z.array(rowSchema).min(1).max(MAX_ROWS),
}).strict()

/** Normaliza una fecha de entrada (YYYY-MM-DD o ISO) a ISO datetime, o null si
 *  no es parseable. Se hace en servidor para no confiar en el formato del CSV. */
function normalizeDueDate(value: string | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export async function POST(
  request: NextRequest,
  { params }: { params: { projectId: string } },
) {
  if (!isUuid(params.projectId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }

  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = importSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Datos inválidos', details: parsed.error.flatten() },
      { status: 422 },
    )
  }
  const { rows } = parsed.data

  const admin = createAdminClient()

  // Cargar el proyecto para obtener su workspace_id.
  const { data: project, error: projectErr } = await admin
    .from('projects')
    .select('id, workspace_id')
    .eq('id', params.projectId)
    .maybeSingle() as {
      data: { id: string; workspace_id: string } | null
      error: unknown
    }
  if (projectErr) {
    console.error('[project import POST] project read error:', projectErr)
    return NextResponse.json({ error: 'Error al importar' }, { status: 500 })
  }
  if (!project) {
    return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })
  }

  // Anti-IDOR: crear tareas es una accion de CONTRIBUIDOR del proyecto, asi que
  // se exige membresia DIRECTA del proyecto (mismo contrato que POST /api/tasks),
  // no solo pertenecer al workspace. El admin client bypassa RLS, por eso el check
  // explicito; sin el, un miembro del workspace de otro equipo podria inyectar
  // tareas en un proyecto ajeno con solo adivinar el projectId.
  const { data: membership, error: memberErr } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', params.projectId)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (memberErr) {
    console.error('[project import POST] membership read error:', memberErr)
    return NextResponse.json({ error: 'Error al importar' }, { status: 500 })
  }
  if (!membership) {
    return NextResponse.json({ error: 'Sin acceso al proyecto' }, { status: 403 })
  }

  // Cargar los estados del proyecto para mapear por nombre y resolver el default
  // (primer estado por posicion). El mapa por nombre es case-insensitive.
  type StatusRow = { id: string; name: string }
  const { data: statuses, error: statusErr } = await admin
    .from('task_statuses')
    .select('id, name')
    .eq('project_id', params.projectId)
    .order('position', { ascending: true }) as { data: StatusRow[] | null; error: unknown }
  if (statusErr) {
    console.error('[project import POST] statuses read error:', statusErr)
    return NextResponse.json({ error: 'Error al importar' }, { status: 500 })
  }

  const defaultStatusId = statuses?.[0]?.id ?? null
  const statusByName = new Map<string, string>()
  for (const s of statuses ?? []) {
    if (s.name) statusByName.set(s.name.trim().toLowerCase(), s.id)
  }

  function resolveStatusId(name: string | undefined): string | null {
    if (name) {
      const hit = statusByName.get(name.trim().toLowerCase())
      if (hit) return hit
    }
    // Si no se matchea el nombre (o no vino), cae al estado default del proyecto.
    return defaultStatusId
  }

  // sort_order: se anexan las tareas al final. Se toma el mayor sort_order actual
  // del proyecto una sola vez y se generan claves consecutivas para el lote.
  type SortRow = { sort_order: string }
  const { data: lastTask } = await admin
    .from('tasks')
    .select('sort_order')
    .eq('project_id', params.projectId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: SortRow | null; error: unknown }

  const { generateKeyBetween } = await import('fractional-indexing')

  let prevKey: string | null = lastTask?.sort_order ?? null
  const inserts = rows.map(r => {
    const sortOrder = generateKeyBetween(prevKey, null)
    prevKey = sortOrder
    return {
      project_id: params.projectId,
      workspace_id: project.workspace_id,
      title: r.title,
      status_id: resolveStatusId(r.status),
      priority: r.priority ?? 'none',
      due_date: normalizeDueDate(r.due_date),
      sort_order: sortOrder,
      created_by: user.id,
    }
  })

  // Insercion en una sola llamada (lote validado completo, sin escritura parcial).
  const db = admin
  const { data: created, error: insertErr } = await db
    .from('tasks')
    .insert(inserts)
    .select('id') as { data: { id: string }[] | null; error: unknown }

  if (insertErr) {
    console.error('[project import POST] insert error:', insertErr)
    return NextResponse.json({ error: 'Error al importar las tareas' }, { status: 500 })
  }

  return NextResponse.json({ created: created?.length ?? 0 }, { status: 201 })
}

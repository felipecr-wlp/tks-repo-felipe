/**
 * GET  /api/projects/[projectId]/task-templates, lista las plantillas de tarea
 *      visibles en este proyecto (las del proyecto + las de todo el workspace).
 * POST /api/projects/[projectId]/task-templates, crea una plantilla de tarea.
 *
 * Una plantilla de tarea es un snapshot reutilizable (titulo sugerido, descripcion,
 * prioridad, estimacion, story points y checklist) para crear tareas nuevas ya
 * prellenadas. Contraparte a nivel TAREA de las plantillas de proyecto.
 *
 * Anti-IDOR: el projectId viene de la ruta y se valida por membresia del proyecto
 * antes de leer o escribir (el admin client ignora RLS).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'

interface RouteParams {
  params: { projectId: string }
}

const PRIORITY_VALUES = ['urgent', 'high', 'medium', 'low', 'none'] as const

type ChecklistItem = { text: string }

type TemplateRow = {
  id: string
  workspace_id: string
  project_id: string | null
  name: string
  title: string
  description: string | null
  priority: string
  estimate_minutes: number | null
  story_points: number | null
  checklist: ChecklistItem[]
  is_shared: boolean
  created_by: string | null
  created_at: string
}

const TEMPLATE_COLUMNS =
  'id, workspace_id, project_id, name, title, description, priority, estimate_minutes, story_points, checklist, is_shared, created_by, created_at'

async function getMembership(
  admin: ReturnType<typeof createAdminClient>,
  projectId: string,
  userId: string,
): Promise<string | null> {
  const { data } = await admin
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  return data?.role ?? null
}

// ── GET ──────────────────────────────────────────────────────────────────────
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
  if (!(await getMembership(admin, params.projectId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  // Workspace del proyecto: para incluir tambien las plantillas de todo el
  // workspace (project_id null) junto a las propias del proyecto.
  type ProjRow = { workspace_id: string }
  const { data: project } = await admin
    .from('projects')
    .select('workspace_id')
    .eq('id', params.projectId)
    .maybeSingle() as { data: ProjRow | null; error: unknown }

  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })

  // Plantillas del proyecto O plantillas de todo el workspace (project_id null),
  // acotadas al workspace del proyecto para nunca cruzar workspaces.
  const { data } = await admin
    .from('task_templates')
    .select(TEMPLATE_COLUMNS)
    .eq('workspace_id', project.workspace_id)
    .or(`project_id.eq.${params.projectId},project_id.is.null`)
    .order('created_at', { ascending: false }) as { data: TemplateRow[] | null }

  return NextResponse.json({ templates: data ?? [] })
}

// ── POST ─────────────────────────────────────────────────────────────────────
const checklistSchema = z.array(z.object({ text: z.string().min(1).max(500).trim() })).max(100)

// Se acepta O BIEN un snapshot de una tarea existente ({ from_task_id }) O BIEN
// campos explicitos. name siempre es obligatorio.
const createSchema = z.object({
  name: z.string().min(1).max(120).trim(),
  from_task_id: z.string().uuid().optional(),
  title: z.string().max(500).trim().optional(),
  description: z.string().max(20000).nullish(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  estimate_minutes: z.number().int().min(0).max(100000).nullish(),
  story_points: z.number().int().min(0).max(1000).nullish(),
  checklist: checklistSchema.optional(),
}).strict()

export async function POST(request: NextRequest, { params }: RouteParams) {
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

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()
  if (!(await getMembership(admin, params.projectId, user.id))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  type ProjRow = { workspace_id: string }
  const { data: project } = await admin
    .from('projects')
    .select('workspace_id')
    .eq('id', params.projectId)
    .maybeSingle() as { data: ProjRow | null; error: unknown }

  if (!project) return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 })

  // Campos a persistir. Arrancan de los explicitos (o sus defaults) y, si viene
  // from_task_id, se sobrescriben con el snapshot de la tarea.
  let title = parsed.data.title ?? ''
  let description: string | null = parsed.data.description ?? null
  let priority: string = parsed.data.priority ?? 'none'
  let estimateMinutes: number | null = parsed.data.estimate_minutes ?? null
  let storyPoints: number | null = parsed.data.story_points ?? null
  let checklist: ChecklistItem[] = parsed.data.checklist ?? []

  if (parsed.data.from_task_id) {
    // Snapshot de una tarea: debe pertenecer a ESTE proyecto (anti cross-proyecto).
    type TaskSnap = {
      title: string
      description: string | null
      priority: string
      estimate_minutes: number | null
      story_points: number | null
    }
    const { data: task } = await admin
      .from('tasks')
      .select('title, description, priority, estimate_minutes, story_points')
      .eq('id', parsed.data.from_task_id)
      .eq('project_id', params.projectId)
      .maybeSingle() as { data: TaskSnap | null; error: unknown }

    if (!task) return NextResponse.json({ error: 'Tarea no encontrada' }, { status: 404 })

    title = task.title
    description = task.description
    priority = task.priority
    estimateMinutes = task.estimate_minutes
    storyPoints = task.story_points

    // Snapshot de la checklist: items de la(s) checklist(s) de la tarea, en orden.
    type ItemRow = { title: string }
    const { data: items } = await admin
      .from('task_checklist_items')
      .select('title')
      .eq('task_id', parsed.data.from_task_id)
      .order('position', { ascending: true }) as { data: ItemRow[] | null; error: unknown }

    checklist = (items ?? []).map(i => ({ text: i.title }))
  }

  const { data, error } = await admin
    .from('task_templates')
    .insert({
      workspace_id: project.workspace_id,
      // Por ahora las plantillas se crean ancladas al proyecto donde se guardan.
      project_id: params.projectId,
      name: parsed.data.name,
      title,
      description,
      priority,
      estimate_minutes: estimateMinutes,
      story_points: storyPoints,
      checklist,
      is_shared: true,
      created_by: user.id,
    })
    .select(TEMPLATE_COLUMNS)
    .single() as { data: TemplateRow | null; error: unknown }

  if (error || !data) {
    console.error('[task-templates POST] insert error:', error)
    return NextResponse.json({ error: 'Error al guardar la plantilla' }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

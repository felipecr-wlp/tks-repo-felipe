/**
 * POST /api/messages, Publica un mensaje en el chat de un equipo.
 * Body: { team_id, body }
 *
 * Authz: solo miembros del equipo pueden publicar. La lectura del historial la
 * hace el Server Component del chat con el admin client (patrón anti-RLS-loop).
 * El realtime sobre la tabla messages entrega el mensaje a los demás en vivo.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { canAccessTeamById } from '@/lib/team-access'
import { applyRateLimit } from '@/lib/rate-limit'

// Un adjunto de mensaje es una referencia minima. Tarjeta de tarea o archivo del
// bucket chat-files; el tipo es abierto para crecer (recordatorio) sin romper.
const taskAttachmentSchema = z.object({
  type: z.literal('task'),
  task_id: z.string().uuid(),
})
const fileAttachmentSchema = z.object({
  type: z.literal('file'),
  path: z.string().min(1).max(400),
  name: z.string().min(1).max(160),
  mime: z.string().min(1).max(120),
  size: z.number().int().nonnegative().max(26214400), // 25MB
})
const attachmentSchema = z.discriminatedUnion('type', [taskAttachmentSchema, fileAttachmentSchema])

const schema = z.object({
  team_id: z.string().uuid(),
  // El cuerpo puede ir vacío si el mensaje adjunta al menos una tarea.
  body:    z.string().max(4000).trim(),
  attachments: z.array(attachmentSchema).max(5).optional(),
}).strict().refine(
  d => d.body.length > 0 || (d.attachments?.length ?? 0) > 0,
  { message: 'El mensaje no puede estar vacío' }
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Attachment = z.infer<typeof attachmentSchema> extends infer T ? T : any

interface MessageRow {
  id: string
  author_id: string
  body: string
  created_at: string
  attachments: Attachment[] | null
}

interface MemberJoinRow {
  profile: { id: string; display_name: string; avatar_url: string | null } | null
}

interface ReactionRow {
  id: string
  message_id: string
  profile_id: string
  emoji: string
}

// Valida y sanea todos los adjuntos del mensaje (anti-IDOR):
//  - tarea: solo se conserva si su proyecto pertenece a este equipo.
//  - archivo: solo si su path está scopeado a team/<teamId>/ (el objeto lo subió
//    nuestro endpoint chat-files, que ya validó el acceso al subir).
// Se preserva el orden original y se limita el total a 5.
async function validateAttachments(
  admin: ReturnType<typeof createAdminClient>,
  teamId: string,
  attachments: Attachment[]
): Promise<Attachment[]> {
  const taskIds = Array.from(
    new Set(attachments.filter((a): a is Extract<Attachment, { type: 'task' }> => a.type === 'task').map(a => a.task_id))
  )
  let allowedTasks = new Set<string>()
  if (taskIds.length > 0) {
    const { data: rows } = (await admin
      .from('tasks')
      .select('id, projects!inner ( team_id )')
      .in('id', taskIds)
      .eq('projects.team_id', teamId)) as { data: { id: string }[] | null; error: unknown }
    allowedTasks = new Set((rows ?? []).map(r => r.id))
  }

  const prefix = `team/${teamId}/`
  const out: Attachment[] = []
  const seenTask = new Set<string>()
  for (const a of attachments) {
    if (a.type === 'task') {
      if (allowedTasks.has(a.task_id) && !seenTask.has(a.task_id)) {
        seenTask.add(a.task_id)
        out.push({ type: 'task', task_id: a.task_id })
      }
    } else if (a.type === 'file') {
      if (a.path.startsWith(prefix) && !a.path.includes('..')) {
        out.push({
          type: 'file',
          path: a.path,
          name: a.name.slice(0, 160),
          mime: a.mime.slice(0, 120),
          size: a.size,
        })
      }
    }
    if (out.length >= 5) break
  }
  return out
}

// ── GET ────────────────────────────────────────────────────────────────────────
// Historial paginado por cursor: /api/messages?team_id=xxx&before=<ISO>&limit=30
// Devuelve mensajes en orden ascendente (viejo -> nuevo) + hasMore para el botón
// "Cargar mensajes anteriores" + members (para resolver autor en el widget
// flotante que no recibe los miembros por props). Solo miembros del equipo leen.
export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const url = new URL(request.url)
  const team_id = url.searchParams.get('team_id')
  const before  = url.searchParams.get('before')
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '30', 10)
  const limit = Math.min(Math.max(Number.isNaN(limitRaw) ? 30 : limitRaw, 1), 100)

  if (!team_id || !z.string().uuid().safeParse(team_id).success) {
    return NextResponse.json({ error: 'team_id inválido' }, { status: 422 })
  }

  const admin = createAdminClient()

  // Verificar acceso al equipo (miembro directo o admin del workspace)
  if (!(await canAccessTeamById(admin, team_id, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })
  }

  // Traemos limit+1 (desc) para saber si hay más historia detrás del cursor
  let query = admin
    .from('messages')
    .select('id, author_id, body, created_at, attachments')
    .eq('team_id', team_id)
    .order('created_at', { ascending: false })
    .limit(limit + 1)

  if (before) query = query.lt('created_at', before)

  const { data: rows } = await query as { data: MessageRow[] | null; error: unknown }

  const list = rows ?? []
  const hasMore = list.length > limit
  const page = (hasMore ? list.slice(0, limit) : list).slice().reverse()

  // Solo enviamos los miembros en la primera página (sin cursor) para ahorrar
  // egress; el cliente los cachea mientras el panel esté abierto.
  let members: { id: string; display_name: string; avatar_url: string | null }[] = []
  if (!before) {
    const { data: memberRows } = await admin
      .from('team_members')
      .select('profile:profiles ( id, display_name, avatar_url )')
      .eq('team_id', team_id) as { data: MemberJoinRow[] | null; error: unknown }
    members = (memberRows ?? []).filter(m => m.profile != null).map(m => m.profile!)
  }

  // Reacciones de los mensajes de esta página (para pintar pills al abrir).
  let reactions: ReactionRow[] = []
  const pageIds = page.map(m => m.id)
  if (pageIds.length > 0) {
    const { data: rxRows } = await admin
      .from('team_message_reactions')
      .select('id, message_id, profile_id, emoji')
      .in('message_id', pageIds) as { data: ReactionRow[] | null; error: unknown }
    reactions = rxRows ?? []
  }

  return NextResponse.json({ messages: page, hasMore, members, reactions })
}

export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request)
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let raw: unknown
  try { raw = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { team_id, body, attachments } = parsed.data
  const admin = createAdminClient()

  // Verificar acceso al equipo (miembro directo o admin del workspace)
  if (!(await canAccessTeamById(admin, team_id, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })
  }

  // Validar adjuntos: tareas del equipo + archivos scopeados a team/<id>/.
  const safeAttachments = attachments?.length
    ? await validateAttachments(admin, team_id, attachments)
    : []

  // workspace_id del equipo (para scoping)
  const { data: team } = await admin
    .from('teams')
    .select('workspace_id')
    .eq('id', team_id)
    .maybeSingle() as { data: { workspace_id: string } | null; error: unknown }

  const { data: message, error } = await admin
    .from('messages')
    .insert({
      team_id,
      workspace_id: team?.workspace_id ?? null,
      author_id: user.id,
      body,
      attachments: safeAttachments,
    })
    .select('id, team_id, author_id, body, created_at, attachments')
    .single()

  if (error || !message) {
    console.error('[messages POST] insert error:', error)
    return NextResponse.json({ error: 'Error al enviar el mensaje' }, { status: 500 })
  }

  return NextResponse.json(message, { status: 201 })
}

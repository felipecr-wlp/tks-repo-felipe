/**
 * /api/workspace-messages, chat GENERAL del workspace (entre equipos).
 *
 * A diferencia de /api/messages (por equipo), este canal es transversal: lo ve
 * y escribe cualquier miembro del workspace, sin importar su equipo. Es el
 * espacio de conversacion inter-equipos.
 *
 * Authz: solo miembros del workspace (o admin/owner de la org) leen y publican.
 * La lectura del historial inicial la hace el Server Component con admin client
 * (patron anti-RLS-loop); el realtime sobre workspace_messages entrega en vivo.
 *
 * v2: soporta adjuntos de archivo (columna attachments jsonb, scoped a
 * workspace/<id>/) y devuelve las reacciones de la pagina para pintarlas al
 * entrar. Las reacciones se alternan por /api/workspace/[workspaceId]/messages/…
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { canAccessWorkspaceById } from '@/lib/team-access'
import { applyRateLimit } from '@/lib/rate-limit'

// Adjunto de archivo del bucket chat-files (el canal General no adjunta tareas,
// que son por equipo). El tipo se mantiene como union para poder crecer.
const fileAttachmentSchema = z.object({
  type: z.literal('file'),
  path: z.string().min(1).max(400),
  name: z.string().min(1).max(160),
  mime: z.string().min(1).max(120),
  size: z.number().int().nonnegative().max(26214400), // 25MB
})
const attachmentSchema = z.discriminatedUnion('type', [fileAttachmentSchema])
type Attachment = z.infer<typeof attachmentSchema>

const schema = z.object({
  workspace_id: z.string().uuid(),
  body: z.string().max(4000).trim(),
  attachments: z.array(attachmentSchema).max(5).optional(),
}).strict().refine(
  d => d.body.length > 0 || (d.attachments?.length ?? 0) > 0,
  { message: 'El mensaje no puede estar vacío' }
)

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

// Sanea los adjuntos: solo archivos scopeados a workspace/<id>/ (el objeto lo
// subio nuestro endpoint chat-files, que ya valido el acceso). Preserva orden,
// tope 5.
function validateAttachments(workspaceId: string, attachments: Attachment[]): Attachment[] {
  const prefix = `workspace/${workspaceId}/`
  const out: Attachment[] = []
  for (const a of attachments) {
    if (a.type === 'file' && a.path.startsWith(prefix) && !a.path.includes('..')) {
      out.push({
        type: 'file',
        path: a.path,
        name: a.name.slice(0, 160),
        mime: a.mime.slice(0, 120),
        size: a.size,
      })
    }
    if (out.length >= 5) break
  }
  return out
}

// ── GET ──────────────────────────────────────────────────────────────────────
// Historial paginado por cursor: /api/workspace-messages?workspace_id=xxx&before=<ISO>&limit=30
// Devuelve mensajes ascendentes (viejo -> nuevo) + hasMore + members (solo en la
// primera pagina) + reactions de la pagina para resolver autores y pintar pills.
export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const url = new URL(request.url)
  const workspace_id = url.searchParams.get('workspace_id')
  const before = url.searchParams.get('before')
  const limitRaw = parseInt(url.searchParams.get('limit') ?? '30', 10)
  const limit = Math.min(Math.max(Number.isNaN(limitRaw) ? 30 : limitRaw, 1), 100)

  if (!workspace_id || !z.string().uuid().safeParse(workspace_id).success) {
    return NextResponse.json({ error: 'workspace_id inválido' }, { status: 422 })
  }

  const admin = createAdminClient()

  if (!(await canAccessWorkspaceById(admin, workspace_id, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al workspace' }, { status: 403 })
  }

  let query = admin
    .from('workspace_messages')
    .select('id, author_id, body, created_at, attachments')
    .eq('workspace_id', workspace_id)
    .order('created_at', { ascending: false })
    .limit(limit + 1)

  if (before) query = query.lt('created_at', before)

  const { data: rows } = await query as { data: MessageRow[] | null; error: unknown }

  const list = rows ?? []
  const hasMore = list.length > limit
  const page = (hasMore ? list.slice(0, limit) : list).slice().reverse()

  // Miembros del workspace (solo en la primera pagina) para resolver autores.
  let members: { id: string; display_name: string; avatar_url: string | null }[] = []
  if (!before) {
    const { data: memberRows } = await admin
      .from('workspace_members')
      .select('profile:profiles ( id, display_name, avatar_url )')
      .eq('workspace_id', workspace_id) as { data: MemberJoinRow[] | null; error: unknown }
    members = (memberRows ?? []).filter(m => m.profile != null).map(m => m.profile!)
  }

  // Reacciones de los mensajes de esta pagina (para pintar pills al abrir).
  let reactions: ReactionRow[] = []
  const pageIds = page.map(m => m.id)
  if (pageIds.length > 0) {
    const { data: rxRows } = await admin
      .from('workspace_message_reactions')
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

  const { workspace_id, body, attachments } = parsed.data
  const admin = createAdminClient()

  if (!(await canAccessWorkspaceById(admin, workspace_id, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al workspace' }, { status: 403 })
  }

  const safeAttachments = attachments?.length
    ? validateAttachments(workspace_id, attachments)
    : []

  const { data: message, error } = await admin
    .from('workspace_messages')
    .insert({ workspace_id, author_id: user.id, body, attachments: safeAttachments })
    .select('id, author_id, body, created_at, attachments')
    .single()

  if (error || !message) {
    console.error('[workspace-messages POST] insert error:', error)
    return NextResponse.json({ error: 'Error al enviar el mensaje' }, { status: 500 })
  }

  return NextResponse.json(message, { status: 201 })
}

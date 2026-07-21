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
import { applyRateLimit } from '@/lib/rate-limit'

const schema = z.object({
  team_id: z.string().uuid(),
  body:    z.string().min(1).max(4000).trim(),
}).strict()

interface MessageRow {
  id: string
  author_id: string
  body: string
  created_at: string
}

interface MemberJoinRow {
  profile: { id: string; display_name: string; avatar_url: string | null } | null
}

// Acceso al chat de un equipo: es miembro directo (team_members) O es admin del
// workspace dueño del equipo (org_role owner/admin, o workspace_members.role
// owner/admin). Replica la regla del sidebar, que a los admins les muestra TODOS
// los equipos del workspace aunque no esten en team_members. Sin este fallback,
// un admin ve el equipo pero el chat responde 403 ("No se pudo cargar la
// conversacion").
async function canAccessTeamChat(
  admin: ReturnType<typeof createAdminClient>,
  teamId: string,
  userId: string
): Promise<boolean> {
  const { data: membership } = await admin
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (membership) return true

  const { data: team } = await admin
    .from('teams')
    .select('workspace_id')
    .eq('id', teamId)
    .maybeSingle() as { data: { workspace_id: string } | null; error: unknown }
  if (!team?.workspace_id) return false

  const { data: profile } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle() as { data: { org_role: string | null } | null; error: unknown }
  const orgRole = profile?.org_role ?? 'member'
  if (orgRole === 'owner' || orgRole === 'admin') return true

  const { data: wsMember } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', team.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  return wsMember?.role === 'owner' || wsMember?.role === 'admin'
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
  if (!(await canAccessTeamChat(admin, team_id, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })
  }

  // Traemos limit+1 (desc) para saber si hay más historia detrás del cursor
  let query = admin
    .from('messages')
    .select('id, author_id, body, created_at')
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

  return NextResponse.json({ messages: page, hasMore, members })
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

  const { team_id, body } = parsed.data
  const admin = createAdminClient()

  // Verificar acceso al equipo (miembro directo o admin del workspace)
  if (!(await canAccessTeamChat(admin, team_id, user.id))) {
    return NextResponse.json({ error: 'Sin acceso al equipo' }, { status: 403 })
  }

  // workspace_id del equipo (para scoping)
  const { data: team } = await admin
    .from('teams')
    .select('workspace_id')
    .eq('id', team_id)
    .maybeSingle() as { data: { workspace_id: string } | null; error: unknown }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: message, error } = await (admin as any)
    .from('messages')
    .insert({
      team_id,
      workspace_id: team?.workspace_id ?? null,
      author_id: user.id,
      body,
    })
    .select('id, team_id, author_id, body, created_at')
    .single()

  if (error || !message) {
    console.error('[messages POST] insert error:', error)
    return NextResponse.json({ error: 'Error al enviar el mensaje' }, { status: 500 })
  }

  return NextResponse.json(message, { status: 201 })
}

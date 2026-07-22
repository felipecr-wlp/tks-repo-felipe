/**
 * GET  /api/notes/[noteId]/comments, Lista comentarios de una nota (hilo lateral)
 * POST /api/notes/[noteId]/comments, Agrega un comentario a la nota
 *
 * Las notas son de alcance workspace (no de proyecto), así que el acceso se
 * ancla en workspace_members + la visibilidad de la nota (private = solo su
 * creador). Espejo del patrón de comentarios de tareas, con `content` mapeado
 * a `body` para la UI.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'
import { canAccessNoteSpace } from '@/lib/note-space-access'

interface RouteParams {
  params: { noteId: string }
}

interface NoteAccess {
  id: string
  workspace_id: string
  space_id: string | null
  title: string
  visibility: string
  created_by: string | null
}

// ── Helper: cargar nota + verificar acceso por workspace + visibilidad ────────
async function loadNoteForComments(
  admin: ReturnType<typeof createAdminClient>,
  noteId: string,
  userId: string,
): Promise<{ note: NoteAccess | null; status: number }> {
  const { data: note } = await admin
    .from('notes')
    .select('id, workspace_id, space_id, title, visibility, created_by')
    .eq('id', noteId)
    .maybeSingle() as { data: NoteAccess | null; error: unknown }

  if (!note) return { note: null, status: 404 }

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', note.workspace_id)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return { note: null, status: 403 }
  if (note.visibility === 'private' && note.created_by !== userId) {
    return { note: null, status: 403 }
  }

  // F3: espacio restringido, mismo check que la ruta principal de la nota.
  if (!(await canAccessNoteSpace(admin, note.space_id, userId))) {
    return { note: null, status: 403 }
  }

  return { note, status: 200 }
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.noteId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { note, status } = await loadNoteForComments(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada o sin acceso' }, { status })

  type RawCommentRow = {
    id: string
    content: string
    created_at: string
    author: { id: string; display_name: string; avatar_url: string | null } | null
  }
  const { data: rawComments } = await admin
    .from('note_comments')
    .select('id, content, created_at, author:profiles ( id, display_name, avatar_url )')
    .eq('note_id', params.noteId)
    .order('created_at', { ascending: true })
    .limit(200) as { data: RawCommentRow[] | null; error: unknown }

  const comments = (rawComments ?? []).map(c => ({
    id: c.id,
    body: c.content,
    created_at: c.created_at,
    author: c.author,
  }))

  return NextResponse.json(comments)
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.noteId)) {
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

  const parsed = z.object({ body: z.string().min(1).max(5000).trim() }).strict().safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 422 })

  const admin = createAdminClient()
  const { note, status } = await loadNoteForComments(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada o sin acceso' }, { status })

  type RawCommentResult = {
    id: string
    content: string
    created_at: string
    author: { id: string; display_name: string; avatar_url: string | null } | null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw, error: insertError } = await (admin as any)
    .from('note_comments')
    .insert({
      note_id: params.noteId,
      workspace_id: note.workspace_id,
      author_id: user.id,
      content: parsed.data.body,
    })
    .select('id, content, created_at, author:profiles ( id, display_name, avatar_url )')
    .single() as { data: RawCommentResult | null; error: unknown }

  if (insertError || !raw) {
    console.error('[note comments POST] insert error:', insertError)
    return NextResponse.json({
      error: 'Error al crear el comentario',
      details: (insertError as { message?: string })?.message,
    }, { status: 500 })
  }

  logActivity({
    verb: ActivityVerbs.NOTE_COMMENTED,
    subject_id: user.id,
    object_type: 'note',
    object_id: note.id,
    object_title: note.title,
    workspace_id: note.workspace_id,
  }).catch(console.error)

  return NextResponse.json({
    id: raw.id,
    body: raw.content,
    created_at: raw.created_at,
    author: raw.author,
  }, { status: 201 })
}

/**
 * GET  /api/notes/[noteId]/mentions, Miembros mencionables (del workspace).
 * POST /api/notes/[noteId]/mentions, Registra menciones y notifica al inbox.
 *
 * Body POST: { mentioned_ids: string[], source: 'comment' | 'body' }
 *
 * Las notas son de alcance workspace, así que los mencionables son los
 * miembros del workspace (no de un proyecto). Espejo del patrón de menciones
 * de tareas:
 *  - Auth + membresia del workspace + visibilidad de la nota (private = solo su
 *    creador; mencionar en una nota privada no tiene destinatarios válidos).
 *  - Menciones SOLO a miembros reales del workspace (se filtran server-side;
 *    nunca se confia en la lista del cliente).
 *  - Cada mencion crea una notificacion NOTE_MENTIONED para el mencionado.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, createNotification, ActivityVerbs, NotificationTypes } from '@/lib/activity'
import { canAccessNoteSpace } from '@/lib/note-space-access'

interface RouteParams {
  params: { noteId: string }
}

const schema = z.object({
  mentioned_ids: z.array(z.string().uuid()).min(1).max(20),
  source: z.enum(['comment', 'body']),
}).strict()

interface NoteAccess {
  id: string
  workspace_id: string
  space_id: string | null
  title: string
  visibility: string
  created_by: string | null
}

async function loadNoteForMentions(
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

  // F3: espacio restringido. Cierra el vector de descubrimiento por mencion:
  // sin esto, alguien fuera del espacio podia @mencionar a otro externo dentro
  // de una nota confidencial y esa mencion le mandaba el link a la nota.
  if (!(await canAccessNoteSpace(admin, note.space_id, userId))) {
    return { note: null, status: 403 }
  }

  return { note, status: 200 }
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { note, status } = await loadNoteForMentions(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada o sin acceso' }, { status })

  type MemberRow = { profile: { id: string; display_name: string | null; avatar_url: string | null } | null }
  const { data: members } = await admin
    .from('workspace_members')
    .select('profile:profiles ( id, display_name, avatar_url )')
    .eq('workspace_id', note.workspace_id) as { data: MemberRow[] | null }

  const list = (members ?? [])
    .filter(m => m.profile != null)
    .map(m => ({ id: m.profile!.id, display_name: m.profile!.display_name ?? 'Miembro', avatar_url: m.profile!.avatar_url }))

  return NextResponse.json(list)
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest, { params }: RouteParams) {
  const limited = await applyRateLimit(request, 'api')
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

  const admin = createAdminClient()
  const { note, status } = await loadNoteForMentions(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada o sin acceso' }, { status })

  // Filtrar a miembros REALES del workspace (nunca confiar en el cliente).
  const uniqueIds = Array.from(new Set(parsed.data.mentioned_ids)).filter(id => id !== user.id)
  if (uniqueIds.length === 0) return NextResponse.json({ mentioned: [] })

  const { data: validMembers } = await admin
    .from('workspace_members')
    .select('profile_id')
    .eq('workspace_id', note.workspace_id)
    .in('profile_id', uniqueIds) as { data: { profile_id: string }[] | null }

  const validIds = (validMembers ?? []).map(m => m.profile_id)
  if (validIds.length === 0) return NextResponse.json({ mentioned: [] })

  const rows = validIds.map(id => ({
    note_id:      params.noteId,
    mentioned_id: id,
    mentioned_by: user.id,
    source:       parsed.data.source,
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insErr } = await (admin as any).from('note_mentions').insert(rows)
  if (insErr) {
    console.error('[note mentions POST] insert error:', insErr)
    return NextResponse.json({ error: 'Error al registrar las menciones' }, { status: 500 })
  }

  // Notificar a cada mencionado (Bandeja) + registrar actividad.
  await Promise.all(validIds.map(async (recipientId) => {
    await createNotification({
      recipient_id: recipientId,
      subject_id:   user.id,
      type:         NotificationTypes.NOTE_MENTIONED,
      object_type:  'note',
      object_id:    note.id,
      object_title: note.title ?? undefined,
      workspace_id: note.workspace_id,
    })
  }))

  await logActivity({
    verb:         ActivityVerbs.NOTE_MENTIONED,
    subject_id:   user.id,
    object_type:  'note',
    object_id:    note.id,
    object_title: note.title ?? undefined,
    workspace_id: note.workspace_id,
    metadata:     { mentioned_ids: validIds, source: parsed.data.source },
  })

  return NextResponse.json({ mentioned: validIds })
}

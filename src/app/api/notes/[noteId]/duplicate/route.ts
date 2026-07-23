/**
 * POST /api/notes/[noteId]/duplicate, duplica una nota.
 *
 * Crea una nueva nota con el mismo content/icon/visibility, agregando
 * "(copia)" al título. La nueva nota queda al mismo nivel (mismo parent).
 * NO duplica recursivamente las sub-páginas (decisión de UX, evita sorpresas).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'
import { canAccessNoteSpace } from '@/lib/note-space-access'
import { sanitizeRichText } from '@/lib/sanitize'

interface RouteParams {
  params: { noteId: string }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.noteId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  type Source = {
    workspace_id: string
    project_id: string | null
    parent_note_id: string | null
    space_id: string | null
    title: string
    content: string | null
    icon: string | null
    visibility: string
    created_by: string | null
  }

  const { data: source } = await admin
    .from('notes')
    .select('workspace_id, project_id, parent_note_id, space_id, title, content, icon, visibility, created_by')
    .eq('id', params.noteId)
    .maybeSingle() as { data: Source | null; error: unknown }

  if (!source) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })

  // Verificar acceso al workspace
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', source.workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  if (source.visibility === 'private' && source.created_by !== user.id) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }
  if (!(await canAccessNoteSpace(admin, source.space_id, user.id))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  type NoteResult = { id: string; title: string; icon: string | null; parent_note_id: string | null }
  const { data: copy, error } = await admin
    .from('notes')
    .insert({
      workspace_id:   source.workspace_id,
      project_id:     source.project_id,
      parent_note_id: source.parent_note_id,
      space_id:       source.space_id,
      title:          `${source.title} (copia)`,
      // Saneado defensivo al copiar: el origen pudo escribirse antes de S21.
      content:        source.content == null ? null : sanitizeRichText(source.content),
      icon:           source.icon,
      // Visibility privada se "personaliza" para el duplicador (su propia copia)
      visibility:     source.visibility === 'private' ? 'private' : source.visibility,
      created_by:     user.id,
    })
    .select('id, title, icon, parent_note_id')
    .single() as { data: NoteResult | null; error: unknown }

  if (error || !copy) {
    console.error('[note duplicate POST] insert error:', error)
    return NextResponse.json({ error: 'Error al duplicar' }, { status: 500 })
  }

  logActivity({
    verb: ActivityVerbs.NOTE_CREATED,
    subject_id: user.id,
    object_type: 'note',
    object_id: copy.id,
    object_title: copy.title,
    workspace_id: source.workspace_id,
    metadata: { duplicated_from: params.noteId },
  }).catch(console.error)

  return NextResponse.json(copy, { status: 201 })
}

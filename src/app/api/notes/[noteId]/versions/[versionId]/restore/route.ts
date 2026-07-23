/**
 * POST /api/notes/[noteId]/versions/[versionId]/restore
 * Restaura una nota a una version anterior. Antes de sobrescribir, se snapshotea
 * el estado actual para que la restauracion sea reversible; luego se aplica el
 * content/title de la version y se recalculan backlinks + historial.
 *
 * Acceso: miembro del workspace + visibilidad (private = solo su creador).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { recomputeNoteLinks } from '@/lib/note-links'
import { snapshotNoteVersion } from '@/lib/note-versions'
import { canAccessNoteSpace } from '@/lib/note-space-access'
import { sanitizeRichText } from '@/lib/sanitize'

interface RouteParams {
  params: { noteId: string; versionId: string }
}

interface NoteRow {
  id: string
  workspace_id: string
  space_id: string | null
  title: string
  content: string | null
  visibility: string
  created_by: string | null
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.noteId) || !isUuid(params.versionId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: note } = await admin
    .from('notes')
    .select('id, workspace_id, space_id, title, content, visibility, created_by')
    .eq('id', params.noteId)
    .maybeSingle() as { data: NoteRow | null }

  if (!note) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', note.workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null }

  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  if (note.visibility === 'private' && note.created_by !== user.id) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }
  if (!(await canAccessNoteSpace(admin, note.space_id, user.id))) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  // Cargar la version a restaurar (debe pertenecer a esta nota).
  const { data: version } = await admin
    .from('note_versions')
    .select('id, note_id, title, content')
    .eq('id', params.versionId)
    .eq('note_id', params.noteId)
    .maybeSingle() as { data: { id: string; note_id: string; title: string; content: string | null } | null }

  if (!version) return NextResponse.json({ error: 'Versión no encontrada' }, { status: 404 })

  // Snapshot del estado ACTUAL antes de sobrescribir (restauración reversible).
  await snapshotNoteVersion(admin, {
    noteId:      note.id,
    workspaceId: note.workspace_id,
    title:       note.title,
    content:     note.content,
    editedBy:    user.id,
  }).catch(console.error)

  // Aplicar la versión a la nota.
  const { data: updated, error } = await admin
    .from('notes')
    // Saneado defensivo: una version historica pudo escribirse ANTES de que
    // existiera el saneado al escribir (S21). Al restaurar no reintroducimos
    // HTML sin sanear en notes.content. Se preserva null (nota vacia).
    .update({ title: version.title, content: version.content == null ? null : sanitizeRichText(version.content), updated_at: new Date().toISOString() })
    .eq('id', note.id)
    .select('id, workspace_id, title, content, updated_at')
    .single() as { data: { id: string; workspace_id: string; title: string; content: string | null; updated_at: string } | null; error: unknown }

  if (error || !updated) {
    return NextResponse.json({ error: 'Error al restaurar' }, { status: 500 })
  }

  // Recalcular backlinks y dejar la versión restaurada como cabeza del historial.
  recomputeNoteLinks(admin, {
    sourceNoteId: updated.id,
    workspaceId:  updated.workspace_id,
    content:      updated.content,
  }).catch(console.error)

  snapshotNoteVersion(admin, {
    noteId:      updated.id,
    workspaceId: updated.workspace_id,
    title:       updated.title,
    content:     updated.content,
    editedBy:    user.id,
  }).catch(console.error)

  return NextResponse.json({ ok: true, title: updated.title, updated_at: updated.updated_at })
}

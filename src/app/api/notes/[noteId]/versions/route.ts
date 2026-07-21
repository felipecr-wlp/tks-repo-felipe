/**
 * GET /api/notes/[noteId]/versions
 * Historial de versiones de una nota (mas reciente primero).
 *
 * Acceso: miembro del workspace + visibilidad (una nota privada solo la ve su
 * creador). Devuelve metadatos (sin el content completo, para no inflar la
 * lista); el content se pide al restaurar o previsualizar por id.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { canAccessNoteSpace } from '@/lib/note-space-access'

interface RouteParams {
  params: { noteId: string }
}

interface NoteRow {
  id: string
  workspace_id: string
  space_id: string | null
  visibility: string
  created_by: string | null
}

interface VersionRow {
  id: string
  title: string
  created_at: string
  updated_at: string
  editor: { display_name: string | null; avatar_url: string | null } | null
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  const { data: note } = await admin
    .from('notes')
    .select('id, workspace_id, space_id, visibility, created_by')
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

  const { data: versions } = await admin
    .from('note_versions')
    .select('id, title, created_at, updated_at, editor:profiles!note_versions_edited_by_fkey ( display_name, avatar_url )')
    .eq('note_id', params.noteId)
    .order('created_at', { ascending: false })
    .limit(50) as { data: VersionRow[] | null }

  const list = (versions ?? []).map(v => ({
    id:         v.id,
    title:      v.title,
    created_at: v.updated_at ?? v.created_at,
    editor:     v.editor ? { display_name: v.editor.display_name ?? 'Usuario', avatar_url: v.editor.avatar_url } : null,
  }))

  return NextResponse.json(list)
}

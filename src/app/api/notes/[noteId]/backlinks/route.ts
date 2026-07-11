/**
 * GET /api/notes/[noteId]/backlinks
 * Notas que ENLAZAN a esta nota (aristas note_links con target = noteId).
 *
 * Acceso: miembro del workspace de la nota + visibilidad (una nota privada
 * solo la ve su creador). Cada backlink respeta la visibilidad de la nota
 * origen: solo se listan las notas origen que el usuario puede ver.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

interface RouteParams {
  params: { noteId: string }
}

interface SourceNote {
  id: string
  title: string
  icon: string | null
  visibility: string
  created_by: string | null
  updated_at: string
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()

  // Cargar la nota objetivo y validar acceso.
  const { data: note } = await admin
    .from('notes')
    .select('id, workspace_id, visibility, created_by')
    .eq('id', params.noteId)
    .maybeSingle() as { data: { id: string; workspace_id: string; visibility: string; created_by: string | null } | null }

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

  // Aristas entrantes.
  const { data: edges } = await admin
    .from('note_links')
    .select('source_note_id')
    .eq('target_note_id', params.noteId) as { data: { source_note_id: string }[] | null }

  const sourceIds = Array.from(new Set((edges ?? []).map(e => e.source_note_id)))
  if (sourceIds.length === 0) return NextResponse.json([])

  const { data: sources } = await admin
    .from('notes')
    .select('id, title, icon, visibility, created_by, updated_at')
    .in('id', sourceIds) as { data: SourceNote[] | null }

  // Respetar visibilidad: una nota origen privada solo la ve su creador.
  const list = (sources ?? [])
    .filter(s => s.visibility !== 'private' || s.created_by === user.id)
    .map(s => ({ id: s.id, title: s.title, icon: s.icon, updated_at: s.updated_at }))

  return NextResponse.json(list)
}

/**
 * POST /api/notes/[noteId]/duplicate, duplica una nota.
 *
 * Crea una nueva nota con el mismo content/icon/visibility, agregando
 * "(copia)" al título. La nueva nota queda al mismo nivel (mismo parent).
 * NO duplica recursivamente las sub-páginas (decisión de UX, evita sorpresas).
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'

interface RouteParams {
  params: { noteId: string }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
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
    title: string
    content: string | null
    icon: string | null
    visibility: string
    created_by: string | null
  }

  const { data: source } = await admin
    .from('notes')
    .select('workspace_id, project_id, parent_note_id, title, content, icon, visibility, created_by')
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

  type NoteResult = { id: string; title: string; icon: string | null; parent_note_id: string | null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: copy, error } = await (admin as any)
    .from('notes')
    .insert({
      workspace_id:   source.workspace_id,
      project_id:     source.project_id,
      parent_note_id: source.parent_note_id,
      title:          `${source.title} (copia)`,
      content:        source.content,
      icon:           source.icon,
      // Visibility privada se "personaliza" para el duplicador (su propia copia)
      visibility:     source.visibility === 'private' ? 'private' : source.visibility,
      created_by:     user.id,
    })
    .select('id, title, icon, parent_note_id')
    .single() as { data: NoteResult | null; error: unknown }

  if (error || !copy) {
    return NextResponse.json({
      error: 'Error al duplicar',
      details: (error as { message?: string })?.message,
    }, { status: 500 })
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

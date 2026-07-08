/**
 * GET    /api/notes/[noteId] — detalle completo de una nota
 * PATCH  /api/notes/[noteId] — actualiza título / content / visibility
 * DELETE /api/notes/[noteId] — elimina la nota (hard delete; las notas no se archivan)
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'

interface RouteParams {
  params: { noteId: string }
}

const patchSchema = z.object({
  title:          z.string().max(200).trim().optional(),
  content:        z.string().nullable().optional(),
  visibility:     z.enum(['private', 'project', 'team', 'workspace']).optional(),
  icon:           z.string().max(8).nullable().optional(),
  parent_note_id: z.string().uuid().nullable().optional(),
}).strict()

interface NoteFull {
  id: string
  workspace_id: string
  project_id: string | null
  parent_note_id: string | null
  icon: string | null
  title: string
  content: string | null
  visibility: string
  created_by: string | null
  created_at: string
  updated_at: string
  author: { display_name: string; avatar_url: string | null } | null
}

// ── Helper: cargar nota con membership check ─────────────────────────────────
async function loadNoteWithAccess(
  admin: ReturnType<typeof createAdminClient>,
  noteId: string,
  userId: string,
): Promise<{ note: NoteFull | null; status: number }> {
  const { data: note } = await admin
    .from('notes')
    .select(`
      id, workspace_id, project_id, parent_note_id, icon,
      title, content, visibility,
      created_by, created_at, updated_at,
      author:profiles ( display_name, avatar_url )
    `)
    .eq('id', noteId)
    .maybeSingle() as { data: NoteFull | null; error: unknown }

  if (!note) return { note: null, status: 404 }

  // Acceso: workspace member + visibility checks
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

  return { note, status: 200 }
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { note, status } = await loadNoteWithAccess(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada' }, { status })

  return NextResponse.json(note)
}

// ── PATCH ────────────────────────────────────────────────────────────────────
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const admin = createAdminClient()
  const { note, status } = await loadNoteWithAccess(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada o sin acceso' }, { status })

  // Solo creador o admin del workspace puede editar
  // (UI: dejar al creador editar; validación más fina se puede hacer aquí)
  // Por ahora cualquiera con acceso puede editar — coherente con docs colaborativos.

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: updated, error } = await (admin as any)
    .from('notes')
    .update({ ...parsed.data, updated_at: new Date().toISOString() })
    .eq('id', params.noteId)
    .select(`
      id, workspace_id, project_id, parent_note_id, icon,
      title, content, visibility,
      created_by, created_at, updated_at,
      author:profiles ( display_name, avatar_url )
    `)
    .single() as { data: NoteFull | null; error: unknown }

  if (error || !updated) {
    return NextResponse.json({
      error: 'Error al actualizar',
      details: (error as { message?: string })?.message,
    }, { status: 500 })
  }

  logActivity({
    verb: ActivityVerbs.NOTE_UPDATED,
    subject_id: user.id,
    object_type: 'note',
    object_id: updated.id,
    object_title: updated.title,
    workspace_id: updated.workspace_id,
  }).catch(console.error)

  return NextResponse.json(updated)
}

// ── DELETE ───────────────────────────────────────────────────────────────────
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { note, status } = await loadNoteWithAccess(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada' }, { status })

  // Permitir: creador OR workspace admin OR org owner/admin
  let canDelete = note.created_by === user.id

  if (!canDelete) {
    type ProfileRole = { org_role: string | null }
    const { data: profile } = await admin
      .from('profiles')
      .select('org_role')
      .eq('id', user.id)
      .maybeSingle() as { data: ProfileRole | null; error: unknown }

    if (profile?.org_role === 'owner' || profile?.org_role === 'admin') {
      canDelete = true
    }

    if (!canDelete) {
      const { data: wsMember } = await admin
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', note.workspace_id)
        .eq('profile_id', user.id)
        .maybeSingle() as { data: { role: string } | null; error: unknown }

      if (wsMember?.role === 'admin') canDelete = true
    }
  }

  if (!canDelete) {
    return NextResponse.json(
      { error: 'Solo el creador o un admin del workspace puede eliminar' },
      { status: 403 }
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin as any)
    .from('notes')
    .delete()
    .eq('id', params.noteId)

  if (error) return NextResponse.json({ error: 'Error al eliminar' }, { status: 500 })
  return NextResponse.json({ ok: true })
}

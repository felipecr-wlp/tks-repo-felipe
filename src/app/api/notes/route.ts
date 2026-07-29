/**
 * GET  /api/notes?workspace_id=xxx, lista de notas del workspace visibles para el user
 * POST /api/notes, crea nueva nota
 *
 * Visibility: private (default) | space | team | project | workspace.
 * El modelo vive en `src/lib/note-visibility.ts`: la nota nace privada y
 * compartirla la abre al DEPARTAMENTO, no a la empresa entera.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { sanitizeRichText } from '@/lib/sanitize'
import { logActivity, ActivityVerbs } from '@/lib/activity'
import { canPostWorkspaceMessage } from '@/lib/workspace-admin'
import {
  NOTE_VISIBILITY_VALUES,
  NOTE_VISIBILITY_DEFAULT,
  loadNoteViewerContext,
  canViewNote,
  noteVisibilityPrefilter,
} from '@/lib/note-visibility'

const createSchema = z.object({
  workspace_id:   z.string().uuid(),
  title:          z.string().max(200).trim().optional(),
  content:        z.string().max(1_000_000).nullable().optional(),
  visibility:     z.enum(NOTE_VISIBILITY_VALUES).default(NOTE_VISIBILITY_DEFAULT),
  project_id:     z.string().uuid().nullable().optional(),
  parent_note_id: z.string().uuid().nullable().optional(),
  space_id:       z.string().uuid().nullable().optional(),
  icon:           z.string().max(64).nullable().optional(),
  doc_kind:       z.enum(['note', 'sop', 'sop_flow', 'sop_index', 'training']).optional(),
  sop_status:     z.enum(['draft', 'review', 'active', 'obsolete']).nullable().optional(),
})

interface NoteListRow {
  id: string
  title: string
  visibility: string
  created_at: string
  updated_at: string
  created_by: string | null
  project_id: string | null
  parent_note_id: string | null
  space_id: string | null
  icon: string | null
  cover: string | null
  author: { display_name: string; avatar_url: string | null } | null
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const url = new URL(request.url)
  const workspace_id = url.searchParams.get('workspace_id')
  if (!workspace_id) {
    return NextResponse.json({ error: 'workspace_id requerido' }, { status: 422 })
  }

  const admin = createAdminClient()

  // Verificar acceso al workspace
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Lista de notas del workspace. La regla completa vive en note-visibility.ts:
  // privada = solo autor, space/team = su departamento, project = su proyecto,
  // workspace = toda la empresa.
  const { data: notes } = await admin
    .from('notes')
    .select(`
      id, title, visibility, created_at, updated_at, created_by, project_id,
      parent_note_id, space_id, icon, cover,
      author:profiles ( display_name, avatar_url )
    `)
    .eq('workspace_id', workspace_id)
    // Privadas ajenas fuera en la consulta (antes del limit), para no gastar
    // slots del tope con notas que igual se ocultarian. El gating de espacios
    // restringidos queda en JS: depende de las membresias que se calculan abajo.
    .or(noteVisibilityPrefilter(user.id))
    .order('updated_at', { ascending: false })
    .limit(200) as { data: NoteListRow[] | null; error: unknown }

  const ctx = await loadNoteViewerContext(admin, workspace_id, user.id)
  const visible = (notes ?? []).filter(n => canViewNote(ctx, n))

  return NextResponse.json({ notes: visible })
}

// ── POST ─────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  let body: unknown
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'JSON inválido' }, { status: 400 }) }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }

  const { workspace_id, title, content, visibility, project_id, parent_note_id, space_id, icon, doc_kind, sop_status } = parsed.data

  const admin = createAdminClient()

  // Verificar acceso al workspace
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return NextResponse.json({ error: 'Sin acceso al workspace' }, { status: 403 })

  // Publicar a TODA la empresa es acto de mando (mismos roles que el comunicado
  // en General). Compartir al departamento no pide permiso: es del autor.
  if (visibility === 'workspace' && !(await canPostWorkspaceMessage(admin, workspace_id, user.id))) {
    return NextResponse.json(
      { error: 'Solo los responsables publican un documento para toda la empresa. Compártelo con tu departamento.' },
      { status: 403 },
    )
  }

  // Compartir al departamento sin departamento no comparte con nadie: se avisa
  // en vez de dejar la nota en un limbo que el autor cree publicado.
  if ((visibility === 'space' || visibility === 'team') && !space_id) {
    return NextResponse.json(
      { error: 'Elige el departamento con el que se comparte la nota.' },
      { status: 422 },
    )
  }

  type NoteResult = {
    id: string
    title: string
    visibility: string
    created_at: string
    updated_at: string
    parent_note_id: string | null
    icon: string | null
  }

  const { data: note, error: insertError } = await admin
    .from('notes')
    .insert({
      workspace_id,
      project_id:     project_id ?? null,
      parent_note_id: parent_note_id ?? null,
      space_id:       space_id ?? null,
      title:          title ?? 'Sin título',
      // Saneado anti stored-XSS al escribir (ver /api/notes/[noteId] PATCH).
      content:        content == null ? null : sanitizeRichText(content),
      visibility,
      icon:           icon ?? null,
      doc_kind:       doc_kind ?? 'note',
      sop_status:     sop_status ?? null,
      created_by:     user.id,
    })
    .select('id, title, visibility, created_at, updated_at, parent_note_id, icon')
    .single() as { data: NoteResult | null; error: unknown }

  if (insertError || !note) {
    console.error('[notes POST] insert error:', insertError)
    return NextResponse.json({
      error: 'Error al crear la nota',    }, { status: 500 })
  }

  logActivity({
    verb: ActivityVerbs.NOTE_CREATED,
    subject_id: user.id,
    object_type: 'note',
    object_id: note.id,
    object_title: note.title,
    workspace_id,
  }).catch(console.error)

  return NextResponse.json(note, { status: 201 })
}

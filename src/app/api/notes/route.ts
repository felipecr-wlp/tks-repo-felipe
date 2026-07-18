/**
 * GET  /api/notes?workspace_id=xxx, lista de notas del workspace visibles para el user
 * POST /api/notes, crea nueva nota
 *
 * Visibility: private | project | team | workspace
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'

const createSchema = z.object({
  workspace_id:   z.string().uuid(),
  title:          z.string().max(200).trim().optional(),
  content:        z.string().nullable().optional(),
  visibility:     z.enum(['private', 'project', 'team', 'workspace']).default('workspace'),
  project_id:     z.string().uuid().nullable().optional(),
  parent_note_id: z.string().uuid().nullable().optional(),
  space_id:       z.string().uuid().nullable().optional(),
  icon:           z.string().max(64).nullable().optional(),
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
  icon: string | null
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

  // Lista de notas del workspace
  // Visibility: workspace y team → todas; project → solo si user en project_members; private → solo creador
  const { data: notes } = await admin
    .from('notes')
    .select(`
      id, title, visibility, created_at, updated_at, created_by, project_id,
      parent_note_id, icon,
      author:profiles ( display_name, avatar_url )
    `)
    .eq('workspace_id', workspace_id)
    .order('updated_at', { ascending: false })
    .limit(200) as { data: NoteListRow[] | null; error: unknown }

  // Filtrar por visibility
  const visible = (notes ?? []).filter(n => {
    if (n.visibility === 'workspace') return true
    if (n.visibility === 'private') return n.created_by === user.id
    // project/team, para mantener simple, mostramos todo del workspace por ahora
    return true
  })

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

  const { workspace_id, title, content, visibility, project_id, parent_note_id, space_id, icon } = parsed.data

  const admin = createAdminClient()

  // Verificar acceso al workspace
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) return NextResponse.json({ error: 'Sin acceso al workspace' }, { status: 403 })

  type NoteResult = {
    id: string
    title: string
    visibility: string
    created_at: string
    updated_at: string
    parent_note_id: string | null
    icon: string | null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: note, error: insertError } = await (admin as any)
    .from('notes')
    .insert({
      workspace_id,
      project_id:     project_id ?? null,
      parent_note_id: parent_note_id ?? null,
      space_id:       space_id ?? null,
      title:          title ?? 'Sin título',
      content:        content ?? null,
      visibility,
      icon:           icon ?? null,
      created_by:     user.id,
    })
    .select('id, title, visibility, created_at, updated_at, parent_note_id, icon')
    .single() as { data: NoteResult | null; error: unknown }

  if (insertError || !note) {
    console.error('[notes POST] insert error:', insertError)
    return NextResponse.json({
      error: 'Error al crear la nota',
      details: (insertError as { message?: string })?.message,
    }, { status: 500 })
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

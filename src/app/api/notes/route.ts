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
import { sanitizeRichText } from '@/lib/sanitize'
import { logActivity, ActivityVerbs } from '@/lib/activity'

const createSchema = z.object({
  workspace_id:   z.string().uuid(),
  title:          z.string().max(200).trim().optional(),
  content:        z.string().max(1_000_000).nullable().optional(),
  visibility:     z.enum(['private', 'project', 'team', 'workspace']).default('workspace'),
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
      parent_note_id, space_id, icon,
      author:profiles ( display_name, avatar_url )
    `)
    .eq('workspace_id', workspace_id)
    // Privadas ajenas fuera en la consulta (antes del limit), para no gastar
    // slots del tope con notas que igual se ocultarian. El gating de espacios
    // restringidos queda en JS: depende de las membresias que se calculan abajo.
    .or(`visibility.neq.private,visibility.is.null,created_by.eq.${user.id}`)
    .order('updated_at', { ascending: false })
    .limit(200) as { data: NoteListRow[] | null; error: unknown }

  // F3: notas en espacios restringidos solo para admin de org o miembros del
  // espacio. Se calculan los espacios restringidos "bloqueados" para este user.
  const { data: prof } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', user.id)
    .maybeSingle() as { data: { org_role: string | null } | null; error: unknown }
  const isOrgAdmin = prof?.org_role === 'owner' || prof?.org_role === 'admin'

  const { data: myMemberships } = await admin
    .from('space_members')
    .select('space_id')
    .eq('profile_id', user.id) as { data: { space_id: string }[] | null; error: unknown }
  const mySpaceIds = new Set((myMemberships ?? []).map(m => m.space_id))

  const { data: restrictedSpaces } = await admin
    .from('spaces')
    .select('id')
    .eq('workspace_id', workspace_id)
    .eq('is_restricted', true) as { data: { id: string }[] | null; error: unknown }
  const blockedSpaceIds = new Set(
    (restrictedSpaces ?? [])
      .filter(s => !isOrgAdmin && !mySpaceIds.has(s.id))
      .map(s => s.id)
  )

  // Las privadas ajenas ya se filtraron en la consulta; aqui solo queda el
  // gating de espacios restringidos (necesita las membresias de arriba).
  const visible = (notes ?? []).filter(n => {
    if (n.space_id && blockedSpaceIds.has(n.space_id)) return false
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

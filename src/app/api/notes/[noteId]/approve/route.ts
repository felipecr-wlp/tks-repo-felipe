/**
 * Aprobacion / firma de un SOP (Nivel 2, Paso 2).
 *
 * GET    /api/notes/[noteId]/approve  -> estado de aprobacion (quien, cuando,
 *        version firmada, y si esta desactualizada vs la version vigente).
 * POST   /api/notes/[noteId]/approve  -> el admin FIRMA la version vigente:
 *        sella approved_by/at/version y pone el documento en 'active'.
 * DELETE /api/notes/[noteId]/approve  -> revoca la firma: limpia el sello y
 *        regresa el documento a 'review'.
 *
 * Solo admins del workspace (org_role owner/admin O rol de workspace owner/admin).
 * `approved_by` es uuid sin FK; el perfil del aprobador se resuelve aqui (evita
 * el embed ambiguo notes->profiles / HTTP 300).
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canAccessNoteSpace } from '@/lib/note-space-access'

interface RouteParams {
  params: { noteId: string }
}

interface NoteApproval {
  id: string
  workspace_id: string
  space_id: string | null
  title: string
  visibility: string
  created_by: string | null
  doc_kind: string
  sop_version: string | null
  approved_by: string | null
  approved_at: string | null
  approved_version: string | null
}

async function loadNote(
  admin: ReturnType<typeof createAdminClient>,
  noteId: string,
  userId: string,
): Promise<{ note: NoteApproval | null; status: number }> {
  const { data: note } = await admin
    .from('notes')
    .select('id, workspace_id, space_id, title, visibility, created_by, doc_kind, sop_version, approved_by, approved_at, approved_version')
    .eq('id', noteId)
    .maybeSingle() as { data: NoteApproval | null; error: unknown }

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
  if (!(await canAccessNoteSpace(admin, note.space_id, userId))) {
    return { note: null, status: 403 }
  }
  return { note, status: 200 }
}

async function isAdminOf(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  const { data: profile } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle() as { data: { org_role: string | null } | null; error: unknown }

  const orgRole = profile?.org_role ?? 'member'
  const role = membership?.role ?? null
  return orgRole === 'owner' || orgRole === 'admin' || role === 'owner' || role === 'admin'
}

async function approverName(
  admin: ReturnType<typeof createAdminClient>,
  approvedBy: string | null,
): Promise<string | null> {
  if (!approvedBy) return null
  const { data } = await admin
    .from('profiles')
    .select('display_name')
    .eq('id', approvedBy)
    .maybeSingle() as { data: { display_name: string | null } | null; error: unknown }
  return data?.display_name ?? 'Usuario'
}

function buildState(note: NoteApproval, name: string | null, canApprove: boolean) {
  const approved = !!note.approved_by && !!note.approved_at
  const outdated = approved && !!note.sop_version && note.approved_version !== note.sop_version
  return {
    approved,
    outdated,
    approved_by: note.approved_by,
    approver_name: name,
    approved_at: note.approved_at,
    approved_version: note.approved_version,
    current_version: note.sop_version,
    can_approve: canApprove,
  }
}

// ── GET ──────────────────────────────────────────────────────────────────────
export async function GET(_request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.noteId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { note, status } = await loadNote(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada o sin acceso' }, { status })

  const [canApprove, name] = await Promise.all([
    isAdminOf(admin, note.workspace_id, user.id),
    approverName(admin, note.approved_by),
  ])

  return NextResponse.json(buildState(note, name, canApprove))
}

// ── POST (firmar la version vigente) ──────────────────────────────────────────
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
  const { note, status } = await loadNote(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada o sin acceso' }, { status })

  if (note.doc_kind === 'note') {
    return NextResponse.json({ error: 'No es un documento operativo' }, { status: 400 })
  }
  if (!(await isAdminOf(admin, note.workspace_id, user.id))) {
    return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })
  }

  const stamp = {
    approved_by:      user.id,
    approved_at:      new Date().toISOString(),
    approved_version: note.sop_version,
    sop_status:       'active',
  }
  const { error } = await admin.from('notes').update(stamp).eq('id', note.id)
  if (error) {
    console.error('[sop approve POST] update error:', error)
    return NextResponse.json({ error: 'Error al aprobar' }, { status: 500 })
  }

  const name = await approverName(admin, user.id)
  return NextResponse.json(buildState({ ...note, ...stamp }, name, true), { status: 201 })
}

// ── DELETE (revocar la firma) ─────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.noteId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { note, status } = await loadNote(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada o sin acceso' }, { status })

  if (!(await isAdminOf(admin, note.workspace_id, user.id))) {
    return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })
  }

  const cleared = {
    approved_by:      null,
    approved_at:      null,
    approved_version: null,
    sop_status:       'review',
  }
  const { error } = await admin.from('notes').update(cleared).eq('id', note.id)
  if (error) {
    return NextResponse.json({ error: 'Error al revocar la aprobación' }, { status: 500 })
  }

  return NextResponse.json(buildState({ ...note, ...cleared }, null, true))
}

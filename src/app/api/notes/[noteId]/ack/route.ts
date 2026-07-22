/**
 * GET    /api/notes/[noteId]/ack, estado de acuse de lectura del SOP
 * POST   /api/notes/[noteId]/ack, el usuario actual marca "Leído y entendido"
 * DELETE /api/notes/[noteId]/ack, el usuario actual retira su acuse
 *
 * Acuse de lectura para SOPs / capacitaciones. El acceso se ancla en
 * workspace_members + visibilidad (private = solo su creador), igual que los
 * comentarios de nota. Se guarda la `sop_version` reconocida: si el SOP publica
 * una versión nueva, el acuse queda "desactualizado" y la UI puede pedir
 * re-acuse.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { canAccessNoteSpace } from '@/lib/note-space-access'

interface RouteParams {
  params: { noteId: string }
}

interface NoteAccess {
  id: string
  workspace_id: string
  space_id: string | null
  title: string
  visibility: string
  created_by: string | null
  sop_version: string | null
}

// Carga la nota + verifica acceso por workspace + visibilidad. Espejo del helper
// de comentarios, con sop_version incluido para sellar el acuse a una versión.
async function loadNote(
  admin: ReturnType<typeof createAdminClient>,
  noteId: string,
  userId: string,
): Promise<{ note: NoteAccess | null; status: number }> {
  const { data: note } = await admin
    .from('notes')
    .select('id, workspace_id, space_id, title, visibility, created_by, sop_version')
    .eq('id', noteId)
    .maybeSingle() as { data: NoteAccess | null; error: unknown }

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

  // F3: espacio restringido. El registro de acuses de un SOP confidencial no
  // debe ser legible ni editable fuera del espacio.
  if (!(await canAccessNoteSpace(admin, note.space_id, userId))) {
    return { note: null, status: 403 }
  }

  return { note, status: 200 }
}

type AckRow = {
  profile_id: string
  acknowledged_at: string
  sop_version: string | null
  profile: { id: string; display_name: string; avatar_url: string | null } | null
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

  const { data: rows } = await admin
    .from('note_acknowledgements')
    .select('profile_id, acknowledged_at, sop_version, profile:profiles ( id, display_name, avatar_url )')
    .eq('note_id', params.noteId)
    .order('acknowledged_at', { ascending: false })
    .limit(500) as { data: AckRow[] | null; error: unknown }

  const acks = (rows ?? []).map(r => ({
    profile_id: r.profile_id,
    display_name: r.profile?.display_name ?? 'Usuario',
    avatar_url: r.profile?.avatar_url ?? null,
    acknowledged_at: r.acknowledged_at,
    sop_version: r.sop_version,
    // Marca "desactualizado": reconoció una versión distinta a la vigente.
    outdated: !!note.sop_version && r.sop_version !== note.sop_version,
  }))

  const mine = acks.find(a => a.profile_id === user.id) ?? null

  return NextResponse.json({
    current_version: note.sop_version,
    count: acks.length,
    acknowledged_by_me: !!mine && !mine.outdated,
    my_ack: mine,
    acks,
  })
}

// ── POST (marcar leído) ───────────────────────────────────────────────────────
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

  // Upsert: un acuse por (nota, usuario). Re-acusar actualiza versión + fecha.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: upsertError } = await (admin as any)
    .from('note_acknowledgements')
    .upsert({
      note_id:         note.id,
      workspace_id:    note.workspace_id,
      profile_id:      user.id,
      sop_version:     note.sop_version,
      acknowledged_at: new Date().toISOString(),
    }, { onConflict: 'note_id,profile_id' })

  if (upsertError) {
    console.error('[note ack POST] upsert error:', upsertError)
    return NextResponse.json({
      error: 'Error al registrar el acuse',
      details: (upsertError as { message?: string })?.message,
    }, { status: 500 })
  }

  return NextResponse.json({ ok: true, acknowledged: true, version: note.sop_version }, { status: 201 })
}

// ── DELETE (retirar acuse) ────────────────────────────────────────────────────
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  if (!isUuid(params.noteId)) {
    return NextResponse.json({ error: 'ID inválido' }, { status: 422 })
  }
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { note, status } = await loadNote(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada o sin acceso' }, { status })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: delError } = await (admin as any)
    .from('note_acknowledgements')
    .delete()
    .eq('note_id', note.id)
    .eq('profile_id', user.id)

  if (delError) {
    return NextResponse.json({ error: 'Error al retirar el acuse' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, acknowledged: false })
}

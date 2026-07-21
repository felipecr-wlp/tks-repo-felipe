/**
 * Cumplimiento obligatorio de SOPs (lectores requeridos).
 *
 * GET    /api/notes/[noteId]/assignments
 *   Devuelve el estado de cumplimiento del documento: a quien se le exige leer
 *   (persona / equipo / departamento), el roster expandido de personas requeridas
 *   con su estatus (done / outdated / pending vs la version vigente) y, solo para
 *   admins, los pools para asignar (miembros, equipos, departamentos).
 *
 * POST   /api/notes/[noteId]/assignments   { target_type, target_id }
 *   Asigna el documento como obligatorio a una persona/equipo/departamento.
 *   Solo admins. Notifica (sop_assigned) a cada persona requerida resultante.
 *
 * DELETE /api/notes/[noteId]/assignments?target_type=&target_id=
 *   Quita una asignacion. Solo admins.
 *
 * Anclado en workspace_members + visibilidad, igual que el acuse (ack). El
 * target_id es polimorfico y sin FK (evita ciclos PostgREST); la validacion de
 * pertenencia al workspace se hace aqui en la capa de API.
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { NotificationTypes } from '@/lib/activity'
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

// Carga la nota + verifica acceso por workspace + visibilidad. Espejo del ack.
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
  if (!(await canAccessNoteSpace(admin, note.space_id, userId))) {
    return { note: null, status: 403 }
  }

  return { note, status: 200 }
}

// Es admin del workspace? (org_role owner/admin O rol de workspace owner/admin).
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

type AssignRow = {
  target_type: 'profile' | 'team' | 'space'
  target_id: string
  created_at: string
}

// Expande una asignacion al conjunto de profile_ids requeridos.
async function expandTargets(
  admin: ReturnType<typeof createAdminClient>,
  assignments: AssignRow[],
): Promise<Set<string>> {
  const required = new Set<string>()

  const profileIds = assignments.filter(a => a.target_type === 'profile').map(a => a.target_id)
  for (const id of profileIds) required.add(id)

  const teamIds = assignments.filter(a => a.target_type === 'team').map(a => a.target_id)
  if (teamIds.length > 0) {
    const { data } = await admin
      .from('team_members')
      .select('profile_id')
      .in('team_id', teamIds) as { data: { profile_id: string }[] | null; error: unknown }
    for (const r of data ?? []) required.add(r.profile_id)
  }

  const spaceIds = assignments.filter(a => a.target_type === 'space').map(a => a.target_id)
  if (spaceIds.length > 0) {
    const { data } = await admin
      .from('space_members')
      .select('profile_id')
      .in('space_id', spaceIds) as { data: { profile_id: string }[] | null; error: unknown }
    for (const r of data ?? []) required.add(r.profile_id)
  }

  return required
}

// ── GET (estado de cumplimiento) ──────────────────────────────────────────────
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { note, status } = await loadNote(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada o sin acceso' }, { status })

  const canAssign = await isAdminOf(admin, note.workspace_id, user.id)

  // ── Asignaciones del documento ──────────────────────────────────────────────
  const { data: rawAssignments } = await admin
    .from('sop_assignments')
    .select('target_type, target_id, created_at')
    .eq('note_id', note.id)
    .order('created_at', { ascending: true }) as { data: AssignRow[] | null; error: unknown }

  const assignments = rawAssignments ?? []

  // Etiquetas legibles + conteo de personas por objetivo.
  const profileTargetIds = assignments.filter(a => a.target_type === 'profile').map(a => a.target_id)
  const teamTargetIds = assignments.filter(a => a.target_type === 'team').map(a => a.target_id)
  const spaceTargetIds = assignments.filter(a => a.target_type === 'space').map(a => a.target_id)

  const [profRows, teamRows, spaceRows] = await Promise.all([
    profileTargetIds.length
      ? admin.from('profiles').select('id, display_name').in('id', profileTargetIds)
      : Promise.resolve({ data: [] }),
    teamTargetIds.length
      ? admin.from('teams').select('id, name').in('id', teamTargetIds)
      : Promise.resolve({ data: [] }),
    spaceTargetIds.length
      ? admin.from('spaces').select('id, name').in('id', spaceTargetIds)
      : Promise.resolve({ data: [] }),
  ]) as [
    { data: { id: string; display_name: string | null }[] | null },
    { data: { id: string; name: string }[] | null },
    { data: { id: string; name: string }[] | null },
  ]

  // Conteo de miembros por equipo/departamento.
  const teamCounts: Record<string, number> = {}
  if (teamTargetIds.length) {
    const { data } = await admin
      .from('team_members')
      .select('team_id')
      .in('team_id', teamTargetIds) as { data: { team_id: string }[] | null; error: unknown }
    for (const r of data ?? []) teamCounts[r.team_id] = (teamCounts[r.team_id] ?? 0) + 1
  }
  const spaceCounts: Record<string, number> = {}
  if (spaceTargetIds.length) {
    const { data } = await admin
      .from('space_members')
      .select('space_id')
      .in('space_id', spaceTargetIds) as { data: { space_id: string }[] | null; error: unknown }
    for (const r of data ?? []) spaceCounts[r.space_id] = (spaceCounts[r.space_id] ?? 0) + 1
  }

  const profName = new Map((profRows.data ?? []).map(p => [p.id, p.display_name ?? 'Usuario']))
  const teamName = new Map((teamRows.data ?? []).map(t => [t.id, t.name]))
  const spaceName = new Map((spaceRows.data ?? []).map(s => [s.id, s.name]))

  const targets = assignments.map(a => {
    if (a.target_type === 'profile') {
      return { type: 'profile' as const, id: a.target_id, label: profName.get(a.target_id) ?? 'Usuario', member_count: 1 }
    }
    if (a.target_type === 'team') {
      return { type: 'team' as const, id: a.target_id, label: teamName.get(a.target_id) ?? 'Equipo', member_count: teamCounts[a.target_id] ?? 0 }
    }
    return { type: 'space' as const, id: a.target_id, label: spaceName.get(a.target_id) ?? 'Departamento', member_count: spaceCounts[a.target_id] ?? 0 }
  })

  // ── Roster de personas requeridas + estatus vs version vigente ───────────────
  const requiredIds = await expandTargets(admin, assignments)

  let roster: { profile_id: string; display_name: string; avatar_url: string | null; status: 'done' | 'outdated' | 'pending'; sop_version: string | null }[] = []
  let doneCount = 0

  if (requiredIds.size > 0) {
    const ids = Array.from(requiredIds)
    const [{ data: people }, { data: acks }] = await Promise.all([
      admin.from('profiles').select('id, display_name, avatar_url').in('id', ids),
      admin.from('note_acknowledgements').select('profile_id, sop_version').eq('note_id', note.id).in('profile_id', ids),
    ]) as [
      { data: { id: string; display_name: string | null; avatar_url: string | null }[] | null },
      { data: { profile_id: string; sop_version: string | null }[] | null },
    ]

    const ackBy = new Map((acks ?? []).map(a => [a.profile_id, a.sop_version]))
    const peopleById = new Map((people ?? []).map(p => [p.id, p]))

    roster = ids.map(id => {
      const p = peopleById.get(id)
      const ackVersion = ackBy.get(id)
      let stat: 'done' | 'outdated' | 'pending'
      if (ackVersion === undefined) stat = 'pending'
      else if (note.sop_version && ackVersion !== note.sop_version) stat = 'outdated'
      else stat = 'done'
      if (stat === 'done') doneCount++
      return {
        profile_id: id,
        display_name: p?.display_name ?? 'Usuario',
        avatar_url: p?.avatar_url ?? null,
        status: stat,
        sop_version: ackVersion ?? null,
      }
    }).sort((a, b) => a.display_name.localeCompare(b.display_name))
  }

  // ── Pools para asignar (solo admins) ─────────────────────────────────────────
  let pools: unknown = undefined
  if (canAssign) {
    const [{ data: members }, { data: teams }, { data: spaces }] = await Promise.all([
      admin.from('workspace_members')
        .select('profile_id, profiles ( id, display_name, avatar_url )')
        .eq('workspace_id', note.workspace_id),
      admin.from('teams').select('id, name').eq('workspace_id', note.workspace_id).order('name'),
      admin.from('spaces').select('id, name, is_restricted').eq('workspace_id', note.workspace_id).eq('is_archived', false).order('name'),
    ]) as [
      { data: { profile_id: string; profiles: { id: string; display_name: string | null; avatar_url: string | null } | null }[] | null },
      { data: { id: string; name: string }[] | null },
      { data: { id: string; name: string; is_restricted: boolean }[] | null },
    ]

    pools = {
      members: (members ?? []).map(m => ({
        profile_id: m.profile_id,
        display_name: m.profiles?.display_name ?? 'Usuario',
        avatar_url: m.profiles?.avatar_url ?? null,
      })).sort((a, b) => a.display_name.localeCompare(b.display_name)),
      teams: teams ?? [],
      spaces: spaces ?? [],
    }
  }

  return NextResponse.json({
    current_version: note.sop_version,
    targets,
    roster,
    required_count: roster.length,
    done_count: doneCount,
    can_assign: canAssign,
    pools,
  })
}

// ── POST (asignar) ────────────────────────────────────────────────────────────
const postSchema = z.object({
  target_type: z.enum(['profile', 'team', 'space']),
  target_id: z.string().uuid(),
}).strict()

export async function POST(request: NextRequest, { params }: RouteParams) {
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

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 })
  }
  const parsed = postSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Datos inválidos', details: parsed.error.flatten() }, { status: 422 })
  }
  const { target_type, target_id } = parsed.data

  // ── Validar que el objetivo pertenece al workspace ──────────────────────────
  let valid = false
  if (target_type === 'profile') {
    const { data } = await admin.from('workspace_members').select('profile_id')
      .eq('workspace_id', note.workspace_id).eq('profile_id', target_id).maybeSingle()
    valid = !!data
  } else if (target_type === 'team') {
    const { data } = await admin.from('teams').select('id')
      .eq('workspace_id', note.workspace_id).eq('id', target_id).maybeSingle()
    valid = !!data
  } else {
    const { data } = await admin.from('spaces').select('id')
      .eq('workspace_id', note.workspace_id).eq('id', target_id).maybeSingle()
    valid = !!data
  }
  if (!valid) {
    return NextResponse.json({ error: 'El objetivo no pertenece al workspace' }, { status: 409 })
  }

  // Upsert idempotente por (nota, tipo, objetivo).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: insErr } = await (admin as any)
    .from('sop_assignments')
    .upsert({
      note_id:      note.id,
      workspace_id: note.workspace_id,
      target_type,
      target_id,
      assigned_by:  user.id,
    }, { onConflict: 'note_id,target_type,target_id' })

  if (insErr) {
    console.error('[sop assignments POST] upsert error:', insErr)
    return NextResponse.json({ error: 'Error al asignar' }, { status: 500 })
  }

  // ── Notificar a las personas requeridas por ESTE objetivo ────────────────────
  const requiredIds = await expandTargets(admin, [{ target_type, target_id, created_at: '' }])
  requiredIds.delete(user.id) // no auto-notificarse
  if (requiredIds.size > 0) {
    const rows = Array.from(requiredIds).map(pid => ({
      workspace_id: note.workspace_id,
      recipient_id: pid,
      subject_id:   user.id,
      type:         NotificationTypes.SOP_ASSIGNED,
      object_type:  'note',
      object_id:    note.id,
      object_title: note.title,
    }))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('notifications').insert(rows)
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}

// ── DELETE (quitar asignacion) ────────────────────────────────────────────────
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const admin = createAdminClient()
  const { note, status } = await loadNote(admin, params.noteId, user.id)
  if (!note) return NextResponse.json({ error: 'No encontrada o sin acceso' }, { status })

  if (!(await isAdminOf(admin, note.workspace_id, user.id))) {
    return NextResponse.json({ error: 'Se requiere rol admin' }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const target_type = searchParams.get('target_type')
  const target_id = searchParams.get('target_id')
  if (!target_type || !target_id) {
    return NextResponse.json({ error: 'Faltan parámetros target_type/target_id' }, { status: 400 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: delErr } = await (admin as any)
    .from('sop_assignments')
    .delete()
    .eq('note_id', note.id)
    .eq('target_type', target_type)
    .eq('target_id', target_id)

  if (delErr) {
    return NextResponse.json({ error: 'Error al quitar la asignación' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

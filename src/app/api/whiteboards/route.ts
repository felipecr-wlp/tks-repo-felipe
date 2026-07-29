/**
 * GET  /api/whiteboards?workspace_id=xxx, lista pizarras del workspace
 * POST /api/whiteboards, crea nueva pizarra
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { applyRateLimit } from '@/lib/rate-limit'
import { logActivity, ActivityVerbs } from '@/lib/activity'
import { loadNoteViewerContext, canViewNote } from '@/lib/note-visibility'
import {
  WHITEBOARD_VISIBILITY_VALUES,
  WHITEBOARD_VISIBILITY_DEFAULT,
  whiteboardVisibilityPrefilter,
  filterVisibleWhiteboards,
} from '@/lib/whiteboard-visibility'
import { canPostWorkspaceMessage } from '@/lib/workspace-admin'

const createSchema = z.object({
  workspace_id: z.string().uuid(),
  title:        z.string().max(200).trim().optional(),
  visibility:   z.enum(WHITEBOARD_VISIBILITY_VALUES).default(WHITEBOARD_VISIBILITY_DEFAULT),
  project_id:   z.string().uuid().nullable().optional(),
  space_id:     z.string().uuid().nullable().optional(),
  // Pizarra incrustada en una nota: hereda el alcance de esa nota.
  note_id:      z.string().uuid().nullable().optional(),
})

interface WhiteboardListRow {
  id: string
  title: string
  visibility: string
  created_at: string
  updated_at: string
  created_by: string | null
  space_id: string | null
  project_id: string | null
  note_id: string | null
  author: { display_name: string; avatar_url: string | null } | null
}

export async function GET(request: NextRequest) {
  const limited = await applyRateLimit(request, 'api')
  if (limited) return limited

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const url = new URL(request.url)
  const workspace_id = url.searchParams.get('workspace_id')
  if (!workspace_id) return NextResponse.json({ error: 'workspace_id requerido' }, { status: 422 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const { data: boards, error: boardsError } = await admin
    .from('whiteboards')
    .select(`
      id, title, visibility, created_at, updated_at, created_by,
      space_id, project_id, note_id,
      author:profiles ( display_name, avatar_url )
    `)
    .eq('workspace_id', workspace_id)
    // Privadas ajenas fuera en la consulta (antes del limit): si se filtraran
    // despues, una privada de otro gastaria un slot y podria esconder una
    // pizarra visible mas reciente del propio usuario. El resto del filtrado
    // (departamento, proyecto, herencia de nota) se remata en memoria, por eso
    // el limite se pide holgado.
    .or(whiteboardVisibilityPrefilter(user.id))
    .order('updated_at', { ascending: false })
    .limit(200) as { data: WhiteboardListRow[] | null; error: unknown }

  if (boardsError) {
    console.error('[whiteboards GET] read error:', boardsError)
    return NextResponse.json({ error: 'Error al cargar pizarras' }, { status: 500 })
  }

  const ctx = await loadNoteViewerContext(admin, workspace_id, user.id)
  const visible = await filterVisibleWhiteboards(admin, ctx, boards ?? [])

  return NextResponse.json({ whiteboards: visible.slice(0, 100) })
}

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

  const { workspace_id, title, visibility, project_id, space_id, note_id } = parsed.data
  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', workspace_id)
    .eq('profile_id', user.id)
    .maybeSingle() as { data: { role: string } | null; error: unknown }
  if (!membership) return NextResponse.json({ error: 'Sin acceso al workspace' }, { status: 403 })

  // Abrir una pizarra a TODA la empresa es acto de mando, igual que publicar un
  // comunicado en General o un documento para todos.
  if (visibility === 'workspace' && !(await canPostWorkspaceMessage(admin, workspace_id, user.id))) {
    return NextResponse.json(
      { error: 'Solo los responsables abren una pizarra a toda la empresa. Compártela con tu departamento.' },
      { status: 403 },
    )
  }

  // Alcance departamento sin departamento no abre a nadie: se comportaria como
  // privada y el autor creeria que la compartio.
  if ((visibility === 'space' || visibility === 'team') && !space_id) {
    return NextResponse.json({ error: 'Elige el departamento con el que se comparte la pizarra.' }, { status: 422 })
  }

  // La pizarra incrustada hereda el alcance de su nota, asi que apuntar a una
  // nota ajena seria una via para leer lo que no te toca. Solo se acepta una
  // nota del mismo workspace que el usuario ya pueda ver.
  if (note_id) {
    const { data: host } = await admin
      .from('notes')
      .select('id, workspace_id, visibility, space_id, project_id, created_by')
      .eq('id', note_id)
      .eq('workspace_id', workspace_id)
      .maybeSingle() as {
        data: { id: string; visibility: string; space_id: string | null; project_id: string | null; created_by: string | null } | null
        error: unknown
      }
    const ctx = await loadNoteViewerContext(admin, workspace_id, user.id)
    if (!host || !canViewNote(ctx, host)) {
      return NextResponse.json({ error: 'Nota no encontrada' }, { status: 404 })
    }
  }

  type WhiteboardInsert = { id: string; title: string; created_at: string }
  const { data: board, error } = await admin
    .from('whiteboards')
    .insert({
      workspace_id,
      project_id: project_id ?? null,
      space_id: space_id ?? null,
      note_id: note_id ?? null,
      title: title ?? 'Pizarra sin título',
      content: null,
      visibility,
      created_by: user.id,
    })
    .select('id, title, created_at')
    .single() as { data: WhiteboardInsert | null; error: unknown }

  if (error || !board) {
    console.error('[whiteboards POST] insert error:', error)
    return NextResponse.json({ error: 'Error al crear la pizarra' }, { status: 500 })
  }

  logActivity({
    verb: ActivityVerbs.WHITEBOARD_CREATED,
    subject_id: user.id,
    object_type: 'whiteboard',
    object_id: board.id,
    object_title: board.title,
    workspace_id,
  }).catch(console.error)

  return NextResponse.json(board, { status: 201 })
}

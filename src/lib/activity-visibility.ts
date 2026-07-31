/**
 * La bitacora de actividad tambien respeta el alcance de notas y pizarras.
 *
 * `activity_events` guarda `object_title`, o sea el TITULO de la nota o de la
 * pizarra, en una tabla plana del workspace. Sin este filtro el feed publica a
 * los 30 miembros el nombre de todo documento privado que alguien toque, que es
 * justo lo que el modelo de `note-visibility.ts` acaba de cerrar. El titulo ya
 * es informacion: "Carta de renuncia" o "Plan de despidos Q3" no deberian
 * aparecerle a nadie mas que a su autor.
 *
 * Las demas clases de evento (tareas, proyectos) no cambian: su acceso ya lo
 * gobierna la membresia del workspace o del proyecto.
 *
 * Fail-closed: si el objeto ya no existe (se borro), el evento se guarda solo
 * para quien administra la organizacion. No se puede comprobar su alcance, asi
 * que se cierra en vez de abrir.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import {
  canViewNote,
  loadNoteViewerContext,
  type NoteVisibilityScope,
} from '@/lib/note-visibility'
import { filterVisibleWhiteboards, type WhiteboardScope } from '@/lib/whiteboard-visibility'

/** Lo minimo que necesita un evento para poder filtrarse. */
export interface ActivityObjectRef {
  object_type: string
  object_id: string | null
}

type NoteRow = NoteVisibilityScope & { id: string }
type BoardRow = WhiteboardScope & { id: string }

/**
 * Filtra un lote de eventos. Como mucho 3 queries extra (contexto del lector,
 * notas del lote, pizarras del lote), y CERO si el lote no toca ninguna nota ni
 * pizarra, que es el caso comun de un feed lleno de tareas.
 *
 * No reordena ni repagina: devuelve el mismo lote sin lo que no toca ver, para
 * que el `offset` de la paginacion siga cuadrando con la base.
 */
export async function filterVisibleActivity<T extends ActivityObjectRef>(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string,
  events: T[],
): Promise<T[]> {
  if (events.length === 0) return []

  const noteIds = [...new Set(
    events.filter(e => e.object_type === 'note' && e.object_id).map(e => e.object_id as string)
  )]
  const boardIds = [...new Set(
    events.filter(e => e.object_type === 'whiteboard' && e.object_id).map(e => e.object_id as string)
  )]
  if (noteIds.length === 0 && boardIds.length === 0) return events

  const ctx = await loadNoteViewerContext(admin, workspaceId, userId)

  const [noteRes, boardRes] = await Promise.all([
    noteIds.length
      ? admin.from('notes')
          .select('id, visibility, space_id, project_id, created_by')
          .in('id', noteIds)
      : Promise.resolve({ data: [] as NoteRow[] }),
    boardIds.length
      ? admin.from('whiteboards')
          .select('id, visibility, space_id, project_id, created_by, note_id')
          .in('id', boardIds)
      : Promise.resolve({ data: [] as BoardRow[] }),
  ])

  const noteRows = (noteRes.data ?? []) as NoteRow[]
  const boardRows = (boardRes.data ?? []) as BoardRow[]

  const knownNotes = new Set(noteRows.map(n => n.id))
  const visibleNotes = new Set(noteRows.filter(n => canViewNote(ctx, n)).map(n => n.id))

  const knownBoards = new Set(boardRows.map(b => b.id))
  const visibleBoards = new Set(
    (await filterVisibleWhiteboards(admin, ctx, boardRows)).map(b => b.id)
  )

  return events.filter(e => {
    if (e.object_type === 'note') {
      if (!e.object_id || !knownNotes.has(e.object_id)) return ctx.isOrgAdmin
      return visibleNotes.has(e.object_id)
    }
    if (e.object_type === 'whiteboard') {
      if (!e.object_id || !knownBoards.has(e.object_id)) return ctx.isOrgAdmin
      return visibleBoards.has(e.object_id)
    }
    return true
  })
}

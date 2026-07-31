/**
 * Modelo de VISIBILIDAD de pizarras. Es el mismo de las notas
 * (`src/lib/note-visibility.ts`) mas una regla propia: HERENCIA.
 *
 * Una pizarra puede existir de dos formas:
 *   a) Suelta, creada desde /whiteboards. Tiene alcance propio: nace privada,
 *      su autor la comparte con un departamento, y abrirla a la empresa entera
 *      es acto de mando. Identico a una nota.
 *   b) Incrustada dentro de una nota (bloque de pizarra del editor). Entonces
 *      `note_id` apunta a esa nota y la pizarra NO tiene alcance propio: hereda
 *      el de la nota. Si no fuera asi, compartir la nota con el departamento
 *      dejaria el dibujo invisible justo para quienes deben leerla.
 *
 * Como todas las rutas leen con service-role (bypassa RLS), la regla vive aqui;
 * la policy `whiteboards_select` es la red de abajo.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import {
  canViewNote,
  type NoteViewerContext,
  type NoteVisibilityScope,
} from '@/lib/note-visibility'

export const WHITEBOARD_VISIBILITY_VALUES = ['private', 'space', 'team', 'project', 'workspace'] as const
export type WhiteboardVisibility = (typeof WHITEBOARD_VISIBILITY_VALUES)[number]

/** Toda pizarra nace privada. */
export const WHITEBOARD_VISIBILITY_DEFAULT: WhiteboardVisibility = 'private'

/** Campos minimos que hay que traer de una pizarra para poder decidir. */
export interface WhiteboardScope extends NoteVisibilityScope {
  /** Si esta puesto, la pizarra vive dentro de esa nota y hereda su alcance. */
  note_id?: string | null
}

/** Reutiliza el prefiltro de notas: mismo criterio, misma forma de fila. */
export { noteVisibilityPrefilter as whiteboardVisibilityPrefilter } from '@/lib/note-visibility'

/**
 * Trae en UNA query el alcance de las notas que hospedan a estas pizarras.
 * Devuelve un mapa vacio si ninguna esta incrustada, sin tocar la base.
 */
async function loadHostNotes(
  admin: ReturnType<typeof createAdminClient>,
  boards: WhiteboardScope[],
): Promise<Map<string, NoteVisibilityScope>> {
  const noteIds = [...new Set(boards.map(b => b.note_id).filter(Boolean))] as string[]
  const byNote = new Map<string, NoteVisibilityScope>()
  if (noteIds.length === 0) return byNote

  const { data } = await admin
    .from('notes')
    .select('id, visibility, space_id, project_id, created_by')
    .in('id', noteIds) as {
      data: (NoteVisibilityScope & { id: string })[] | null
      error: unknown
    }

  for (const n of data ?? []) byNote.set(n.id, n)
  return byNote
}

/**
 * Alcance efectivo: el de la nota que la hospeda, o el propio si esta suelta.
 * Una pizarra huerfana (apunta a una nota que ya no existe) se queda con el
 * suyo, que tras la migracion es 'private': falla cerrando, no abriendo.
 */
function effectiveScope(
  board: WhiteboardScope,
  hostNotes: Map<string, NoteVisibilityScope>,
): NoteVisibilityScope {
  if (board.note_id) return hostNotes.get(board.note_id) ?? board
  return board
}

/**
 * Filtra un lote de pizarras. Una sola query extra para todo el lote, sin N+1.
 * Usar despues de `loadNoteViewerContext`, que ya resuelve el contexto del
 * lector una vez por request.
 */
export async function filterVisibleWhiteboards<T extends WhiteboardScope>(
  admin: ReturnType<typeof createAdminClient>,
  ctx: NoteViewerContext,
  boards: T[],
): Promise<T[]> {
  if (boards.length === 0) return []
  const hostNotes = await loadHostNotes(admin, boards)
  return boards.filter(b => canViewNote(ctx, effectiveScope(b, hostNotes)))
}

/** Variante de una sola pizarra (paginas de detalle y API por id). */
export async function canViewWhiteboard(
  admin: ReturnType<typeof createAdminClient>,
  ctx: NoteViewerContext,
  board: WhiteboardScope,
): Promise<boolean> {
  const visible = await filterVisibleWhiteboards(admin, ctx, [board])
  return visible.length === 1
}

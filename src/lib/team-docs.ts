/**
 * Documentos de un EQUIPO: notas, reglas y SOPs que viven en la vista general
 * del equipo.
 *
 * Decision de diseño (importante): NO se inventa un concepto nuevo. Un equipo
 * ya pertenece a un departamento (`teams.space_id`) y las notas ya se comparten
 * por departamento (`notes.space_id`). Entonces "documentos del equipo" ES la
 * carpeta del departamento del equipo, leida con el MISMO predicado de
 * visibilidad que el resto de la app (`canViewNote`). Cero permisos nuevos,
 * cero columnas nuevas, cero migracion.
 *
 * Consecuencia practica que hay que entender: un documento privado del autor
 * NO aparece aqui aunque el autor sea del equipo. Aparece cuando lo comparte
 * con su departamento, que es exactamente la regla del negocio.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import { canViewNote, loadNoteViewerContext, noteVisibilityPrefilter } from '@/lib/note-visibility'

export type TeamDocKind = 'note' | 'sop' | 'sop_flow' | 'sop_index' | 'training'
export type TeamDocStatus = 'draft' | 'review' | 'active' | 'obsolete'

export interface TeamDoc {
  id: string
  title: string
  icon: string | null
  /** Clave de portada elegida; null = color automatico por id. */
  cover: string | null
  doc_kind: TeamDocKind
  sop_status: TeamDocStatus | null
  updated_at: string
  visibility: string
  created_by: string | null
  space_id: string | null
  project_id: string | null
  author: { display_name: string | null } | null
}

/** Un documento operativo (regla, procedimiento, capacitacion) vs una nota suelta. */
export function isProcessDoc(doc: { doc_kind: TeamDocKind }): boolean {
  return doc.doc_kind !== 'note'
}

/**
 * Trae los documentos del departamento del equipo que este usuario puede ver.
 * Si el equipo no tiene departamento asignado devuelve vacio: no hay carpeta
 * donde vivir, y la UI lo dice en vez de mostrar una lista misteriosamente vacia.
 */
export async function loadTeamDocs(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  spaceId: string | null,
  userId: string,
  limit = 200,
): Promise<TeamDoc[]> {
  if (!spaceId) return []

  const { data } = await admin
    .from('notes')
    .select(`
      id, title, icon, cover, doc_kind, sop_status, updated_at, visibility,
      created_by, space_id, project_id,
      author:profiles ( display_name )
    `)
    .eq('workspace_id', workspaceId)
    .eq('space_id', spaceId)
    // Privadas ajenas fuera ya en la base, para no gastar slots del limite en
    // filas que igual se ocultarian abajo.
    .or(noteVisibilityPrefilter(userId))
    .order('updated_at', { ascending: false })
    .limit(limit) as { data: TeamDoc[] | null; error: unknown }

  const ctx = await loadNoteViewerContext(admin, workspaceId, userId)
  return (data ?? []).filter(d => canViewNote(ctx, d))
}

/** Etiqueta legible del tipo de documento, para no repetir el switch en cada vista. */
export const DOC_KIND_LABEL: Record<TeamDocKind, string> = {
  note: 'Nota',
  sop: 'Procedimiento',
  sop_flow: 'Flujo',
  sop_index: 'Índice',
  training: 'Capacitación',
}

/** Etiqueta y color del estado de un documento operativo. */
export const DOC_STATUS_META: Record<TeamDocStatus, { label: string; className: string }> = {
  draft:    { label: 'Borrador', className: 'bg-muted text-muted-foreground' },
  review:   { label: 'En revisión', className: 'bg-yellow-100 text-yellow-700' },
  active:   { label: 'Vigente', className: 'bg-green-100 text-green-700' },
  obsolete: { label: 'Obsoleto', className: 'bg-gray-100 text-gray-500 line-through' },
}

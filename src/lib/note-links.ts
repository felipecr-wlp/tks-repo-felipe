/**
 * Backlinks entre notas (Circuito A3).
 *
 * El editor guarda enlaces internos como <a href="/w/<slug>/notes/<uuid>">.
 * Al guardar el contenido de una nota, extraemos los UUID de nota referenciados
 * y reescribimos la tabla note_links para ese "source" (borrar + reinsertar).
 *
 * La escritura la hace SIEMPRE el service_role desde el API, nunca el cliente,
 * porque note_links no expone policies de insert/delete a usuarios normales.
 */
import type { createAdminClient } from '@/lib/supabase/server'

const NOTE_HREF_RE = /\/notes\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi

/** Extrae los UUID de nota referenciados en un HTML de contenido. */
export function extractNoteLinkIds(content: string | null | undefined): string[] {
  if (!content) return []
  const ids = new Set<string>()
  let m: RegExpExecArray | null
  NOTE_HREF_RE.lastIndex = 0
  while ((m = NOTE_HREF_RE.exec(content)) !== null) {
    ids.add(m[1].toLowerCase())
  }
  return Array.from(ids)
}

/**
 * Recalcula las aristas note_links para una nota "source" a partir de su HTML.
 * Solo se enlazan notas que existan en el MISMO workspace (nunca se confia en
 * el href crudo). Best-effort: si falla, no rompe el guardado del contenido.
 */
export async function recomputeNoteLinks(
  admin: ReturnType<typeof createAdminClient>,
  params: { sourceNoteId: string; workspaceId: string; content: string | null | undefined },
): Promise<void> {
  const { sourceNoteId, workspaceId, content } = params
  const candidateIds = extractNoteLinkIds(content).filter(id => id !== sourceNoteId)

  // Validar que los targets sean notas reales del mismo workspace.
  let validTargets: string[] = []
  if (candidateIds.length > 0) {
    const { data: targets } = await admin
      .from('notes')
      .select('id')
      .eq('workspace_id', workspaceId)
      .in('id', candidateIds) as { data: { id: string }[] | null }
    validTargets = (targets ?? []).map(t => t.id)
  }

  // Reescribir: borrar todas las aristas de este source y reinsertar las validas.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('note_links').delete().eq('source_note_id', sourceNoteId)

  if (validTargets.length === 0) return

  const rows = validTargets.map(targetId => ({
    workspace_id:   workspaceId,
    source_note_id: sourceNoteId,
    target_note_id: targetId,
  }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('note_links').upsert(rows, { onConflict: 'source_note_id,target_note_id', ignoreDuplicates: true })
}

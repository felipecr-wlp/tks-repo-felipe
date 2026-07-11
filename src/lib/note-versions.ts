/**
 * Historial de versiones de notas (Circuito A4).
 *
 * Cada guardado de contenido genera un snapshot. Para no explotar el historial
 * con el autosave (cada ~1.2s), coalesce ediciones seguidas del MISMO autor
 * dentro de una ventana corta en una sola version (se actualiza en sitio).
 * Fuera de esa ventana, o si cambia el autor, se crea una version nueva.
 *
 * La escritura la hace SIEMPRE el service_role desde el API, nunca el cliente.
 */
import type { createAdminClient } from '@/lib/supabase/server'

// Ventana de coalesce: ediciones del mismo autor dentro de este lapso se
// funden en la misma version en vez de crear una nueva por cada autosave.
const COALESCE_WINDOW_MS = 3 * 60 * 1000 // 3 minutos

interface LatestVersion {
  id: string
  content: string | null
  edited_by: string | null
  created_at: string
}

/**
 * Crea o coalesce una version del contenido actual de la nota.
 * Best-effort: si falla, no rompe el guardado del contenido.
 */
export async function snapshotNoteVersion(
  admin: ReturnType<typeof createAdminClient>,
  params: {
    noteId: string
    workspaceId: string
    title: string
    content: string | null | undefined
    editedBy: string
  },
): Promise<void> {
  const { noteId, workspaceId, title, content, editedBy } = params
  const normalized = content ?? null

  const { data: latest } = await admin
    .from('note_versions')
    .select('id, content, edited_by, created_at')
    .eq('note_id', noteId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: LatestVersion | null }

  // Sin cambios reales respecto a la ultima version: no versionar.
  if (latest && latest.content === normalized) return

  const now = Date.now()
  const withinWindow = latest
    ? now - new Date(latest.created_at).getTime() < COALESCE_WINDOW_MS
    : false
  const sameAuthor = latest?.edited_by === editedBy

  if (latest && withinWindow && sameAuthor) {
    // Coalesce: actualizar la version mas reciente en sitio.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any)
      .from('note_versions')
      .update({ title, content: normalized, updated_at: new Date().toISOString() })
      .eq('id', latest.id)
    return
  }

  // Version nueva.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('note_versions').insert({
    note_id:      noteId,
    workspace_id: workspaceId,
    title,
    content:      normalized,
    edited_by:    editedBy,
  })
}

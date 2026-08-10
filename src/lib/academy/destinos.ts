/**
 * Comprobacion de los destinos de ramificacion (server-only).
 *
 * POR QUE EXISTE. Una opcion con `go` apuntando a un video que no existe es
 * un boton que lleva a un 404: la persona queda atrapada a mitad de la
 * historia sin forma de seguir. Y no se descubre al guardar, se descubre
 * cuando alguien lo esta viendo. Se valida al ESCRIBIR, que es cuando el
 * autor todavia esta mirando la pantalla y puede corregirlo.
 *
 * LO QUE ESTO NO PUEDE GARANTIZAR: que el destino siga existiendo mañana.
 * Si alguien borra un video al que otro ramifica, el enlace queda roto y esta
 * comprobacion ya paso. Por eso el reproductor ademas degrada con gracia y el
 * borrado avisa a quien lo ejecuta (ver DELETE de videos).
 */
import type { createAdminClient } from '@/lib/supabase/server'
import { destinosDeInteracciones, type Interaccion } from './videos'

/**
 * Devuelve los ids de destino que NO existen. Vacio = todo en orden.
 * `exceptoId` permite que un video se apunte a si mismo (un bucle
 * deliberado) mientras se esta creando y todavia no tiene fila.
 */
export async function destinosInexistentes(
  admin: ReturnType<typeof createAdminClient>,
  interacciones: readonly Interaccion[],
  exceptoId?: string,
): Promise<string[]> {
  const ids = destinosDeInteracciones(interacciones).filter((id) => id !== exceptoId)
  if (ids.length === 0) return []

  const { data, error } = await admin
    .from('academy_videos')
    .select('id')
    .in('id', ids)

  // Ante un fallo de consulta NO se inventa que todo esta bien: se reporta
  // todo como faltante y el guardado se detiene. Preferible un falso error
  // que publicar una historia con caminos rotos.
  if (error) return ids

  const existentes = new Set((data ?? []).map((r) => r.id))
  return ids.filter((id) => !existentes.has(id))
}

/**
 * Videos que ramifican HACIA `videoId`. Se usa al borrar: quien borra tiene
 * derecho a saber que va a romper tres historias antes de hacerlo.
 */
export async function videosQueApuntanA(
  admin: ReturnType<typeof createAdminClient>,
  videoId: string,
): Promise<Array<{ id: string; title: string }>> {
  // El destino vive dentro de un jsonb anidado (interactions[].opts[].go), que
  // no se puede filtrar con un operador simple. Como el catalogo es de
  // decenas de videos, se traen los que tienen interacciones y se cruzan en
  // memoria: mas claro que una consulta jsonb ilegible, y mas barato que la
  // pantalla de soporte del dia que alguien rompa una historia sin enterarse.
  const { data, error } = await admin
    .from('academy_videos')
    .select('id, title, interactions')
    .neq('id', videoId)

  if (error || !data) return []

  const apuntan: Array<{ id: string; title: string }> = []
  for (const fila of data) {
    const its = fila.interactions
    if (!Array.isArray(its)) continue
    const usa = its.some((it) => {
      const opts = (it as { opts?: unknown })?.opts
      return Array.isArray(opts) && opts.some((o) => (o as { go?: unknown })?.go === videoId)
    })
    if (usa) apuntan.push({ id: fila.id, title: fila.title })
  }
  return apuntan
}

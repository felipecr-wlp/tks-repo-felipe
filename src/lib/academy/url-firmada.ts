/**
 * URL firmada REUSABLE para reproducir un video.
 *
 * POR QUE NO SE FIRMA EN CADA CARGA. El token de una URL firmada lleva su
 * propio instante de emision, asi que dos llamadas seguidas devuelven cadenas
 * distintas para el mismo archivo. Para el navegador eso es OTRO recurso: el
 * cache no aplica y cada visita descarga el video ENTERO otra vez.
 *
 * Medido en produccion antes de este cambio: dos cargas de la misma pagina
 * daban dos URLs distintas.
 *
 * Con video eso se paga caro. Un video de 200MB visto por 60 personas son
 * 12GB; si cada una lo abre tres veces (lo normal cuando hay ramificacion y se
 * vuelve atras), son 36GB por el mismo contenido.
 *
 * QUE HACE. Guarda la URL en la fila del video y la reusa mientras le queden
 * mas de MARGEN_RENOVACION. Todos comparten la misma cadena, asi que el cache
 * del navegador por fin sirve.
 *
 * EL INTERCAMBIO, dicho de frente: una URL que vive 24h se puede compartir
 * durante 24h (antes 4h). Para capacitacion interna es aceptable, y es la
 * misma decision que ya se tomo al elegir URLs firmadas en vez de DRM. El
 * numero vive AQUI, en un solo lugar, para poder bajarlo sin buscarlo.
 */
import type { createAdminClient } from '@/lib/supabase/server'
import { VIDEO_BUCKET } from './videos'

/** Cuanto vive una URL firmada. */
export const TTL_URL_FIRMADA = 24 * 60 * 60

/**
 * Se renueva cuando le quedan menos de esto. Sin margen, alguien podria
 * recibir una URL a punto de caducar y quedarse a media reproduccion: el
 * video se corta y parece un fallo de red.
 */
export const MARGEN_RENOVACION = 2 * 60 * 60

interface FilaCache {
  storage_path: string
  signed_url: string | null
  signed_url_expires_at: string | null
}

/**
 * Devuelve una URL de reproduccion, reusando la guardada si sigue vigente.
 *
 * @returns la URL, o null si el objeto no se pudo firmar (no existe).
 */
export async function urlDeReproduccion(
  admin: ReturnType<typeof createAdminClient>,
  videoId: string,
  fila: FilaCache,
): Promise<string | null> {
  const ahora = Date.now()
  const expira = fila.signed_url_expires_at ? new Date(fila.signed_url_expires_at).getTime() : 0

  if (fila.signed_url && expira - ahora > MARGEN_RENOVACION * 1000) {
    return fila.signed_url
  }

  const { data, error } = await admin
    .storage
    .from(VIDEO_BUCKET)
    .createSignedUrl(fila.storage_path, TTL_URL_FIRMADA)

  if (error || !data?.signedUrl) return null

  // El guardado es best-effort a proposito: si falla, se devuelve la URL igual
  // y lo unico que se pierde es el cache. Que no se pueda escribir el cache no
  // es razon para no dejar ver el video.
  void admin
    .from('academy_videos')
    .update({
      signed_url: data.signedUrl,
      signed_url_expires_at: new Date(ahora + TTL_URL_FIRMADA * 1000).toISOString(),
    })
    .eq('id', videoId)
    .then(({ error: e }) => {
      if (e) console.error('[url-firmada] no se pudo cachear:', e)
    })

  return data.signedUrl
}

/**
 * Invalida el cache. Se llama al cambiar el archivo o al borrar: dejar una URL
 * viva apuntando a un objeto que ya no existe daria un reproductor que gira
 * sin explicar por que.
 */
export async function invalidarUrl(
  admin: ReturnType<typeof createAdminClient>,
  videoId: string,
): Promise<void> {
  await admin
    .from('academy_videos')
    .update({ signed_url: null, signed_url_expires_at: null })
    .eq('id', videoId)
}

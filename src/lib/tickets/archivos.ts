/**
 * Constantes y utilidades del bucket privado `ticket-files` (adjuntos de las
 * solicitudes).
 *
 * Vive fuera de los route handlers porque un `route.ts` de App Router solo puede
 * exportar los verbos HTTP; exportar otra cosa rompe el build. Ademas el
 * componente cliente necesita el tope y la lista para avisar ANTES de subir, y
 * este modulo no importa nada de servidor.
 */

export const TICKET_FILES_BUCKET = 'ticket-files'
export const TICKET_FILES_MAX_SIZE = 50 * 1024 * 1024 // 50MB

/**
 * Debe coincidir con `allowed_mime_types` del bucket en la migracion
 * 20260811000000. Si aqui sobra un tipo que alla no esta, la API firma la subida
 * y storage la rechaza despues: el usuario ve "error al subir" sin motivo.
 *
 * ── Por que hay cuatro formas de decir ZIP ──────────────────────────────────
 * Chrome en Windows reporta un .zip como `application/x-zip-compressed` (lo lee
 * del registro de Windows), Firefox como `application/zip`, y para .rar y .7z
 * varios navegadores mandan cadena vacia. Una allowlist con solo
 * 'application/zip' rechaza el caso mas comun de esta oficina.
 *
 * Sin SVG a proposito: un SVG puede llevar script y aqui no hay ninguna razon
 * para adjuntar uno (para logos de marca estan los adjuntos de tarea).
 */
export const TICKET_FILES_MIME_ALLOWLIST = new Set([
  'application/zip', 'application/x-zip-compressed', 'multipart/x-zip',
  'application/x-rar-compressed', 'application/vnd.rar',
  'application/x-7z-compressed', 'application/gzip', 'application/x-tar',
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/csv', 'text/markdown', 'application/json',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
])

/**
 * Cuando el navegador no manda tipo (pasa con .rar y .7z), se deduce de la
 * extension. Sin esto, adjuntar un .rar falla con "tipo no permitido" aunque el
 * .rar SI este permitido, que es de los errores mas dificiles de entender: el
 * usuario ve el archivo correcto rechazado por su nombre correcto.
 */
const POR_EXTENSION: Record<string, string> = {
  zip: 'application/zip',
  rar: 'application/vnd.rar',
  '7z': 'application/x-7z-compressed',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  tar: 'application/x-tar',
}

export function normalizaMime(nombre: string, mime: string | null | undefined): string {
  const declarado = (mime || '').trim().toLowerCase()
  if (declarado && TICKET_FILES_MIME_ALLOWLIST.has(declarado)) return declarado
  const ext = nombre.toLowerCase().split('.').pop() ?? ''
  const porExt = POR_EXTENSION[ext]
  if (porExt) return porExt
  return declarado
}

/** Limpia el nombre de archivo: sin traversal, sin separadores, acotado. */
export function nombreSeguro(raw: string | null | undefined): string {
  return (raw || 'archivo').replace(/[^\w.\-]+/g, '_').slice(0, 120)
}

/**
 * Path canonico de un adjunto. TODO objeto de una solicitud vive bajo
 * `ticket/<ticketId>/`, y ese prefijo es lo que se valida al registrar un
 * archivo subido por signed URL: sin el, un cliente podria reclamar como propio
 * un objeto de OTRA solicitud pasando su path.
 */
export function prefijoDeSolicitud(ticketId: string): string {
  return `ticket/${ticketId}/`
}

/** Un adjunto ya guardado, tal como viaja en la columna jsonb. */
export interface Adjunto {
  path: string
  name: string
  size: number
  mime: string
}

/** Lee la columna jsonb descartando lo que no tenga forma de adjunto. */
export function leerAdjuntos(raw: unknown): Adjunto[] {
  if (!Array.isArray(raw)) return []
  const out: Adjunto[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    if (typeof a.path !== 'string' || typeof a.name !== 'string') continue
    out.push({
      path: a.path,
      name: a.name,
      size: typeof a.size === 'number' ? a.size : 0,
      mime: typeof a.mime === 'string' ? a.mime : 'application/octet-stream',
    })
  }
  return out
}

/** Un enlace de referencia, tal como viaja en la columna jsonb. */
export interface Enlace {
  url: string
  label: string
}

/**
 * Lee y SANEA los enlaces. Solo http y https: un `javascript:` guardado aqui se
 * convertiria en XSS en cuanto alguien lo pinte como <a href>, y este campo lo
 * llena cualquiera que pueda levantar una solicitud.
 */
export function leerEnlaces(raw: unknown): Enlace[] {
  if (!Array.isArray(raw)) return []
  const out: Enlace[] = []
  for (const item of raw) {
    let url = ''
    let label = ''
    if (typeof item === 'string') url = item
    else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      url = typeof o.url === 'string' ? o.url : ''
      label = typeof o.label === 'string' ? o.label : ''
    }
    if (!esUrlSegura(url)) continue
    out.push({ url, label: label || url })
  }
  return out.slice(0, 20)
}

export function esUrlSegura(url: string): boolean {
  if (!url || url.length > 2000) return false
  try {
    const u = new URL(url)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

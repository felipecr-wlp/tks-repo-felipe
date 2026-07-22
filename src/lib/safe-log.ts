/**
 * errMessage: reduce un error a un MENSAJE seguro para logs (CWE-532, Insertion of
 * Sensitive Information into Log File).
 *
 * Loguear el objeto de error CRUDO de un cliente HTTP (googleapis / gaxios) vuelca su
 * `.config` y su `.response`: el body de la peticion de token (con `client_secret` y
 * el `code` de OAuth) y el header `Authorization` (con el `access_token`). Eso mete
 * secretos en los logs del servidor, que se retienen, se envian a terceros y los ve
 * ops. Este helper extrae SOLO el mensaje, nunca el objeto ni su config/headers.
 *
 * Acepta Error (gaxios extiende Error), string, y objetos de error planos con
 * `.message` (p.ej. PostgrestError de Supabase), para no perder el mensaje util sin
 * arrastrar campos sensibles.
 */
export function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (
    e &&
    typeof e === 'object' &&
    'message' in e &&
    typeof (e as { message: unknown }).message === 'string'
  ) {
    return (e as { message: string }).message
  }
  return 'error desconocido'
}

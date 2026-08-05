/**
 * Traduce el fallo de un chat de IA al texto que ve la persona.
 *
 * Vive aparte, y no dentro de cada panel, porque los DOS chats del producto
 * (KERN y BITACORA) se equivocaban igual y por el mismo motivo tecnico.
 *
 * El motivo: `useChat` del SDK no entrega el json del servidor. Ante una
 * respuesta !ok lanza `new Error(await response.text())`, asi que el cuerpo
 * llega CRUDO dentro de `error.message` y hay que abrirlo a mano. El resto del
 * producto hace `data.error ?? respaldo` sobre el json y por eso si enseña el
 * motivo real; los chats eran el unico sitio donde ese cuerpo se tiraba a la
 * basura y se pintaba una frase fija.
 *
 * Lo que costaba, medido en produccion el 2026-08-05: el servidor respondia
 * 429 "se agoto la cuota diaria del modelo" y la pantalla decia, segun el
 * chat, "revisa que el asistente este configurado en el servidor" o "verifica
 * que la API key de Gemini este configurada". No habia nada mal configurado y
 * la key estaba sana. Un rojo que apunta al sitio equivocado es peor que uno
 * mudo: manda a arreglar algo que no esta roto (rotar una credencial buena) y
 * de paso esconde la causa verdadera, que se arregla sola al dia siguiente o
 * subiendo el plan.
 *
 * Enseñar el mensaje del servidor es seguro aqui: todas las salidas de fallo
 * de /api/kern y /api/daily-reports/agent devuelven un `{ error }` redactado
 * para que lo lea una persona (cuota agotada, conversacion demasiado larga,
 * sin acceso al espacio, imagen no valida). Ninguna devuelve el mensaje crudo
 * de una excepcion: eso lo sujeta tests/error-disclosure-invariant.test.ts.
 *
 * Si el cuerpo NO es ese json (un 504 del gateway, una pagina de error de la
 * plataforma, html) no se vuelca crudo en pantalla: se cae al respaldo.
 */
export const RESPALDO_ERROR_IA = 'No se pudo responder. Vuelve a intentarlo en un momento.'

/** Techo de lo que se pinta. Un cuerpo largo no es un mensaje para leer. */
const MAX_LARGO = 300

export function mensajeDeErrorIA(error: { message?: string } | null | undefined): string {
  if (!error?.message) return RESPALDO_ERROR_IA
  try {
    const cuerpo: unknown = JSON.parse(error.message)
    const motivo = (cuerpo as { error?: unknown }).error
    if (typeof motivo === 'string' && motivo.trim() && motivo.length <= MAX_LARGO) {
      return motivo
    }
  } catch {
    // Cuerpo que no es json. No se enseña crudo.
  }
  return RESPALDO_ERROR_IA
}

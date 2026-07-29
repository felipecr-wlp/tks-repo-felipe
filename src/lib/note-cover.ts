/**
 * Portada de una nota, sin que nadie tenga que elegir nada.
 *
 * Subir una imagen de portada es justo el tipo de paso que la gente no da: la
 * nota se queda en blanco y el documento se ve como un formulario. Aqui el color
 * sale del propio id, asi que cada nota tiene una portada estable y distinta
 * desde el segundo cero, sin configuracion, sin storage y sin una decision mas.
 *
 * Se usan tonos de baja saturacion para que el titulo encima siga siendo legible
 * y para que no compita con el contenido.
 */

/** Hash estable y barato (FNV-1a de 32 bits) sobre el id. */
function hashOf(id: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/**
 * Degradado suave y reproducible para la banda de portada. Dos tonos vecinos en
 * la rueda de color: se lee como una sola tela, no como dos colores pegados.
 */
export function coverGradient(id: string): string {
  const h = hashOf(id)
  const hue = h % 360
  const hue2 = (hue + 38) % 360
  return `linear-gradient(105deg, hsl(${hue} 52% 62%) 0%, hsl(${hue2} 58% 54%) 100%)`
}

/** Version tenue del mismo color, para fondos de tarjeta en listados. */
export function coverTint(id: string): string {
  const hue = hashOf(id) % 360
  return `hsl(${hue} 45% 92%)`
}

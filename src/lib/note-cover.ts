/**
 * Portada de una nota.
 *
 * Regla de diseño: NUNCA hay una nota fea. Subir una imagen de portada es justo
 * el paso que la gente no da, asi que el documento nace con un color estable
 * derivado de su propio id: cada nota se reconoce de un vistazo desde el segundo
 * cero, sin configuracion, sin storage y sin una decision mas.
 *
 * Elegir portada es opcional y encima de eso: quien quiera, escoge una de la
 * paleta y se guarda en `notes.cover`. Si esta vacia se cae al color automatico.
 * Por eso la paleta es CERRADA (no hay selector de color libre): garantiza que
 * el titulo encima siga siendo legible y que la app no se llene de fucsias.
 *
 * Cada preset trae su version tenue (`tint`) para las tarjetas de los listados,
 * asi la misma nota se ve igual en la lista y adentro.
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

export interface CoverPreset {
  key: string
  label: string
  /** Degradado de la banda de portada. */
  css: string
  /** Version tenue del mismo color, para el mosaico del icono en listados. */
  tint: string
}

/**
 * Paleta cerrada. Los degradados usan dos tonos vecinos y saturacion media para
 * que el titulo blanco o negro encima siempre se lea.
 */
export const COVER_PRESETS: CoverPreset[] = [
  { key: 'arena',    label: 'Arena',    css: 'linear-gradient(105deg, hsl(38 62% 68%) 0%, hsl(28 66% 58%) 100%)',   tint: 'hsl(38 55% 92%)' },
  { key: 'durazno',  label: 'Durazno',  css: 'linear-gradient(105deg, hsl(18 72% 68%) 0%, hsl(6 68% 60%) 100%)',    tint: 'hsl(18 60% 93%)' },
  { key: 'coral',    label: 'Coral',    css: 'linear-gradient(105deg, hsl(352 68% 66%) 0%, hsl(336 58% 56%) 100%)', tint: 'hsl(352 58% 94%)' },
  { key: 'vino',     label: 'Vino',     css: 'linear-gradient(105deg, hsl(340 42% 48%) 0%, hsl(318 38% 36%) 100%)', tint: 'hsl(340 34% 92%)' },
  { key: 'lavanda',  label: 'Lavanda',  css: 'linear-gradient(105deg, hsl(268 58% 70%) 0%, hsl(252 56% 60%) 100%)', tint: 'hsl(268 52% 94%)' },
  { key: 'indigo',   label: 'Índigo',   css: 'linear-gradient(105deg, hsl(232 56% 60%) 0%, hsl(220 60% 48%) 100%)', tint: 'hsl(232 50% 93%)' },
  { key: 'cielo',    label: 'Cielo',    css: 'linear-gradient(105deg, hsl(202 72% 66%) 0%, hsl(190 66% 52%) 100%)', tint: 'hsl(202 62% 93%)' },
  { key: 'oceano',   label: 'Océano',   css: 'linear-gradient(105deg, hsl(196 58% 44%) 0%, hsl(184 62% 32%) 100%)', tint: 'hsl(196 48% 92%)' },
  { key: 'menta',    label: 'Menta',    css: 'linear-gradient(105deg, hsl(162 52% 62%) 0%, hsl(150 48% 50%) 100%)', tint: 'hsl(162 46% 92%)' },
  { key: 'bosque',   label: 'Bosque',   css: 'linear-gradient(105deg, hsl(146 38% 44%) 0%, hsl(132 42% 32%) 100%)', tint: 'hsl(146 34% 91%)' },
  { key: 'oliva',    label: 'Oliva',    css: 'linear-gradient(105deg, hsl(78 42% 56%) 0%, hsl(64 46% 44%) 100%)',   tint: 'hsl(78 40% 91%)' },
  { key: 'grafito',  label: 'Grafito',  css: 'linear-gradient(105deg, hsl(220 12% 52%) 0%, hsl(220 14% 34%) 100%)', tint: 'hsl(220 14% 92%)' },
]

const PRESET_BY_KEY = new Map(COVER_PRESETS.map(p => [p.key, p]))

/**
 * Fondo de la banda de portada. `cover` es lo guardado en la nota; si viene
 * vacio o con una clave desconocida (por ejemplo una paleta vieja) se cae al
 * color automatico derivado del id, que siempre existe.
 */
export function coverBackground(id: string, cover?: string | null): string {
  const preset = cover ? PRESET_BY_KEY.get(cover) : undefined
  return preset ? preset.css : coverGradient(id)
}

/** Version tenue del mismo color, para fondos de tarjeta en listados. */
export function coverTint(id: string, cover?: string | null): string {
  const preset = cover ? PRESET_BY_KEY.get(cover) : undefined
  if (preset) return preset.tint
  const hue = hashOf(id) % 360
  return `hsl(${hue} 45% 92%)`
}

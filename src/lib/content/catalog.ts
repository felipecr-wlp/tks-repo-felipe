/**
 * Planificador de contenido: catalogo compartido y compresion de imagenes.
 *
 * Lo importan el NAVEGADOR y el SERVIDOR, asi que no puede tocar Node ni
 * Supabase. Los tres catalogos (redes, formatos, estados) y los topes de bytes
 * viven aqui UNA sola vez, para que el cliente comprima contra el mismo numero
 * con el que la API va a rechazar y para que nadie invente una red social
 * escribiendola distinto en dos pantallas.
 *
 * ── Por que el catalogo de redes es codigo y no una tabla ────────────────────
 * Agregar una red social no deberia costar una migracion ni un formulario de
 * administracion. Viaja con el deploy, igual que `features.ts`. La columna
 * `network` de la base no tiene CHECK a proposito: quien valida es la API contra
 * este archivo, y una clave vieja que sobre se ignora al leer en vez de romper
 * la fila.
 *
 * ── Por que 400px de miniatura ──────────────────────────────────────────────
 * Una galeria es el peor caso de egress: se ven muchas imagenes a la vez. La
 * miniatura se pinta a ~200px, y el doble cubre pantallas retina. A 400px en
 * WebP una pieza ronda 30KB, asi que un tablero con 40 piezas baja ~1.2MB en vez
 * de los ~40MB que costaria servir los originales. La version completa solo sale
 * de storage cuando alguien abre la pieza.
 */

import { encodeWithinBudget } from '@/lib/image-compress'

export const CONTENT_ASSETS_BUCKET = 'content-assets'

/** Lado mayor de la version que se ve al abrir la pieza. Suficiente para revisar un diseño. */
export const CONTENT_IMAGE_MAX_EDGE = 1440

/** Lado mayor de la miniatura de la galeria. */
export const CONTENT_THUMB_MAX_EDGE = 400

/** Techo del objeto grande YA comprimido. La API rechaza por encima de esto. */
export const CONTENT_IMAGE_MAX_BYTES = 700 * 1024

/** Techo de la miniatura. Si una miniatura pasa de aqui, algo salio mal al codificar. */
export const CONTENT_THUMB_MAX_BYTES = 80 * 1024

/**
 * Tope de lo que la persona ELIGE, antes de comprimir. No es un limite de
 * producto sino de memoria: decodificar una imagen de 60MP en canvas puede
 * tumbar la pestaña en un equipo modesto.
 */
export const CONTENT_SOURCE_MAX_BYTES = 25 * 1024 * 1024

/** Formatos que la API acepta almacenar. Espeja allowed_mime_types del bucket. */
export const CONTENT_IMAGE_MIMES = ['image/webp', 'image/jpeg'] as const

/**
 * Imagenes por pieza. Diez es el maximo de un carrusel de Instagram, que es el
 * formato mas largo que se publica. Mas que eso no es una pieza, son varias.
 */
export const MAX_ASSETS_PER_ITEM = 10

/** Prefijo canonico de todo objeto de una pieza. Se valida al firmar y al subir. */
export function contentAssetPrefix(itemId: string): string {
  return `item/${itemId}/`
}

// ── Redes sociales ──────────────────────────────────────────────────────────

export interface RedSocial {
  /** Clave que se guarda en la base. ASCII, minusculas, estable. */
  key: string
  /** Nombre visible. */
  label: string
  /**
   * Formatos de esa red. El primero es el que se propone por defecto, porque en
   * un formulario todo campo vacio es un campo que alguien va a dejar vacio.
   */
  formats: string[]
  /** Color de la etiqueta en la galeria. Clases de Tailwind, no hex sueltos. */
  chip: string
}

export const CONTENT_NETWORKS: RedSocial[] = [
  {
    key: 'instagram',
    label: 'Instagram',
    formats: ['Reel', 'Carrusel', 'Post', 'Historia'],
    chip: 'bg-pink-100 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300',
  },
  {
    key: 'facebook',
    label: 'Facebook',
    formats: ['Post', 'Reel', 'Historia'],
    chip: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    formats: ['Video', 'Carrusel'],
    chip: 'bg-slate-200 text-slate-800 dark:bg-slate-500/20 dark:text-slate-200',
  },
  {
    key: 'linkedin',
    label: 'LinkedIn',
    formats: ['Post', 'Carrusel', 'Artículo'],
    chip: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  },
  {
    key: 'youtube',
    label: 'YouTube',
    formats: ['Video', 'Short'],
    chip: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  },
  {
    key: 'x',
    label: 'X',
    formats: ['Post', 'Hilo'],
    chip: 'bg-neutral-200 text-neutral-800 dark:bg-neutral-500/20 dark:text-neutral-200',
  },
  {
    key: 'google',
    label: 'Google Business',
    formats: ['Publicación', 'Oferta', 'Novedad'],
    chip: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  },
  {
    key: 'blog',
    label: 'Blog / Web',
    formats: ['Artículo', 'Caso de éxito'],
    chip: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  },
  {
    key: 'email',
    label: 'Correo',
    formats: ['Campaña', 'Boletín'],
    chip: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  },
]

const NETWORK_BY_KEY = new Map(CONTENT_NETWORKS.map((n) => [n.key, n]))

export function getNetwork(key: string): RedSocial | undefined {
  return NETWORK_BY_KEY.get(key)
}

export function isNetwork(key: unknown): key is string {
  return typeof key === 'string' && NETWORK_BY_KEY.has(key)
}

/**
 * Etiqueta para pintar. Si la clave ya no esta en el catalogo (una red que se
 * retiro) se muestra la clave cruda en vez de un hueco: la pieza vieja sigue
 * siendo legible y nadie pierde su trabajo por un cambio de catalogo.
 */
export function networkLabel(key: string): string {
  return NETWORK_BY_KEY.get(key)?.label ?? key
}

export function networkChip(key: string): string {
  return (
    NETWORK_BY_KEY.get(key)?.chip ??
    'bg-neutral-200 text-neutral-700 dark:bg-neutral-500/20 dark:text-neutral-300'
  )
}

// ── Estados ─────────────────────────────────────────────────────────────────

export type ContentStatus = 'por_aprobar' | 'aprobado' | 'publicado'

export interface EstadoDef {
  key: ContentStatus
  label: string
  /** Se muestra vacio bajo el titulo de la columna cuando no hay piezas. */
  vacio: string
}

/**
 * El orden ES el del tablero, de izquierda a derecha. Son tres y nada mas: cada
 * estado extra es una columna que alguien tiene que mantener, y el trabajo se
 * queda estancado en la que nadie mira.
 */
export const CONTENT_STATUSES: EstadoDef[] = [
  {
    key: 'por_aprobar',
    label: 'Por aprobar',
    vacio: 'Nada esperando revisión.',
  },
  {
    key: 'aprobado',
    label: 'Aprobados',
    vacio: 'Nada listo para salir.',
  },
  {
    key: 'publicado',
    label: 'Publicados',
    vacio: 'Todavía no se publica nada.',
  },
]

const STATUS_KEYS = new Set<string>(CONTENT_STATUSES.map((s) => s.key))

export function isContentStatus(v: unknown): v is ContentStatus {
  return typeof v === 'string' && STATUS_KEYS.has(v)
}

export function statusLabel(key: string): string {
  return CONTENT_STATUSES.find((s) => s.key === key)?.label ?? key
}

// ── Compresion ──────────────────────────────────────────────────────────────

export interface ContentImage {
  /** Version completa, la que se ve al abrir la pieza. */
  full: Blob
  /** Miniatura, la unica que carga la galeria. */
  thumb: Blob
  /** Dimensiones de `full`, para reservar espacio y evitar salto de layout. */
  width: number
  height: number
  /** Extension segun el codec que de verdad se pudo usar. */
  ext: 'webp' | 'jpg'
}

/**
 * Toma el archivo que eligio la persona y devuelve las dos versiones listas para
 * subir. Lanza Error con mensaje en español si no se puede procesar.
 *
 * A diferencia de `compressImageForUpload`, aqui fallar NO puede devolver el
 * original: sin miniatura la galeria tendria que bajar la imagen completa por
 * cada pieza, que es justo el costo que este modulo existe para evitar. Mas vale
 * rechazar la subida que dejar entrar un objeto que se cobra en cada visita.
 */
export async function prepareContentImage(file: File): Promise<ContentImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Ese archivo no es una imagen.')
  }
  if (file.size > CONTENT_SOURCE_MAX_BYTES) {
    throw new Error('La imagen pesa demasiado. Máximo 25MB.')
  }

  let bitmap: ImageBitmap
  try {
    // `from-image` respeta la orientacion EXIF: sin esto, las fotos verticales
    // tomadas con celular se suben acostadas.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    throw new Error('No se pudo leer la imagen. Puede estar dañada o en un formato no soportado.')
  }

  try {
    // WebP primero (pesa ~30% menos que JPEG a calidad equivalente); JPEG es el
    // respaldo para navegadores que no saben codificarlo.
    for (const [mime, ext] of [
      ['image/webp', 'webp'],
      ['image/jpeg', 'jpg'],
    ] as const) {
      const full = await encodeWithinBudget(bitmap, CONTENT_IMAGE_MAX_EDGE, CONTENT_IMAGE_MAX_BYTES, mime)
      if (!full) continue
      const thumb = await encodeWithinBudget(bitmap, CONTENT_THUMB_MAX_EDGE, CONTENT_THUMB_MAX_BYTES, mime)
      if (!thumb) continue

      return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height, ext }
    }
  } finally {
    // Libera la memoria del decodificado sin esperar al recolector.
    bitmap.close()
  }

  throw new Error('No se pudo comprimir la imagen en este navegador.')
}

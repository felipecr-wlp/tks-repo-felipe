/**
 * Evidencia en imagen del reporte diario: topes compartidos y compresion.
 *
 * Este archivo lo importan el NAVEGADOR y el SERVIDOR, asi que no puede tocar
 * nada de Node ni de Supabase. Los topes viven aqui una sola vez para que el
 * cliente comprima contra el mismo numero con el que la API va a rechazar.
 *
 * ── Por que se comprime en el navegador y no en el servidor ─────────────────
 * La alternativa clasica es subir el original y redimensionar en el backend con
 * sharp. Aqui se descarto por tres razones concretas:
 *
 *   1. El original de 4MB viajaria igual por la red del usuario y por la
 *      serverless function. Comprimiendo antes, sube 200KB.
 *   2. sharp es una dependencia binaria pesada que engorda el bundle de la
 *      function y su tiempo de arranque en frio.
 *   3. La transformacion de imagenes de Supabase es un add-on de pago y se
 *      cobra por imagen servida: resolveria el tamaño cobrando justo por lo que
 *      se queria ahorrar.
 *
 * El canvas del navegador hace el mismo trabajo, gratis, y en la maquina de
 * quien sube. La API valida el resultado, asi que un cliente manipulado que
 * intente saltarse la compresion se topa con los mismos topes.
 *
 * ── Por que dos objetos por imagen ──────────────────────────────────────────
 * `thumb` es lo unico que se pinta en la linea de tiempo. Un dia del equipo con
 * 20 capturas baja ~400KB en miniaturas en vez de ~5MB en originales; la version
 * completa solo sale de storage si alguien de verdad hace clic. Ese es el
 * ahorro de egress, y es de un orden de magnitud, no marginal.
 */

export const REPORT_IMAGES_BUCKET = 'daily-report-images'

/** Lado mayor de la version que se ve al hacer clic. Suficiente para leer una captura de pantalla. */
export const REPORT_IMAGE_MAX_EDGE = 1600

/** Lado mayor de la miniatura. Se muestra a ~150px, el doble cubre pantallas retina. */
export const REPORT_THUMB_MAX_EDGE = 320

/** Techo del objeto grande YA comprimido. La API rechaza por encima de esto. */
export const REPORT_IMAGE_MAX_BYTES = 900 * 1024

/** Techo de la miniatura. Si una miniatura pasa de aqui, algo salio mal al codificar. */
export const REPORT_THUMB_MAX_BYTES = 90 * 1024

/**
 * Tope de lo que el usuario ELIGE, antes de comprimir. No es un limite de
 * producto sino de memoria: decodificar una imagen de 60MP en canvas puede
 * tumbar la pestaña en un equipo modesto.
 */
export const REPORT_SOURCE_MAX_BYTES = 25 * 1024 * 1024

/** Formatos que la API acepta almacenar. Espeja allowed_mime_types del bucket. */
export const REPORT_IMAGE_MIMES = ['image/webp', 'image/jpeg'] as const

/**
 * Cuantas imagenes admite UNA actividad. Cuatro alcanzan para documentar algo
 * ("antes, despues, el error, el ticket"); mas que eso es un album, y un album
 * dentro de un reporte diario nadie lo mira.
 */
export const MAX_IMAGES_PER_ENTRY = 4

/** Techo por dia y persona. Es el freno duro de costo de almacenamiento. */
export const MAX_IMAGES_PER_REPORT = 24

/** Prefijo canonico de todo objeto de un reporte. Se valida al firmar y al subir. */
export function reportImagePrefix(reportId: string): string {
  return `report/${reportId}/`
}

export interface PreparedImage {
  /** Version completa, la que se ve al hacer clic. */
  full: Blob
  /** Miniatura, la unica que carga el listado. */
  thumb: Blob
  /** Dimensiones de `full`, para reservar espacio y evitar salto de layout. */
  width: number
  height: number
  /** Extension segun el codec que de verdad se pudo usar. */
  ext: 'webp' | 'jpg'
}

/** Escala manteniendo proporcion, sin agrandar nunca una imagen chica. */
function fit(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const factor = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * factor)),
    height: Math.max(1, Math.round(height * factor)),
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, mime, quality))
}

/**
 * Codifica bajando calidad hasta entrar en el presupuesto de bytes.
 *
 * Se baja CALIDAD antes que tamaño porque una captura de pantalla aguanta mucha
 * compresion sin volverse ilegible, mientras que reducir pixeles si borra el
 * texto, que suele ser justo lo que la persona quiere mostrar. Solo si la
 * calidad minima no alcanza se recorta el lado mayor.
 */
async function encodeWithinBudget(
  source: ImageBitmap,
  maxEdge: number,
  budget: number,
  mime: string,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  let edge = maxEdge

  // Dos vueltas de tamaño como mucho: si a 60% del lado y calidad minima aun no
  // entra, es que el presupuesto esta mal calibrado, no que falten intentos.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { width, height } = fit(source.width, source.height, edge)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    // Fondo blanco: un PNG con transparencia sobre JPEG saldria con fondo negro.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(source, 0, 0, width, height)

    for (const quality of [0.72, 0.6, 0.5, 0.42]) {
      const blob = await canvasToBlob(canvas, mime, quality)
      // toBlob devuelve null (o cambia de tipo) si el navegador no sabe escribir
      // ese codec. Se aborta para que el llamador reintente con JPEG.
      if (!blob) return null
      if (blob.type !== mime) return null
      if (blob.size <= budget) return { blob, width, height }
    }

    edge = Math.round(edge * 0.75)
  }

  return null
}

/**
 * Toma el archivo que eligio la persona y devuelve las dos versiones listas
 * para subir. Lanza Error con mensaje en español si no se puede procesar.
 */
export async function prepareReportImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Ese archivo no es una imagen.')
  }
  if (file.size > REPORT_SOURCE_MAX_BYTES) {
    throw new Error('La imagen pesa demasiado. Máximo 25MB.')
  }

  // `from-image` respeta la orientacion EXIF: sin esto, las fotos tomadas en
  // vertical con celular se suben acostadas.
  let bitmap: ImageBitmap
  try {
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
      const full = await encodeWithinBudget(bitmap, REPORT_IMAGE_MAX_EDGE, REPORT_IMAGE_MAX_BYTES, mime)
      if (!full) continue
      const thumb = await encodeWithinBudget(bitmap, REPORT_THUMB_MAX_EDGE, REPORT_THUMB_MAX_BYTES, mime)
      if (!thumb) continue

      return { full: full.blob, thumb: thumb.blob, width: full.width, height: full.height, ext }
    }
  } finally {
    // Libera la memoria del decodificado sin esperar al recolector.
    bitmap.close()
  }

  throw new Error('No se pudo comprimir la imagen en este navegador.')
}

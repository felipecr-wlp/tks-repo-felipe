/**
 * Compresion de imagenes en el NAVEGADOR, compartida por toda la app.
 *
 * Nace de `daily-report-images.ts`, que ya comprimia bien pero solo para el
 * reporte diario. El resto de la app (chat de equipo, chat general, adjuntos de
 * tarea) subia el archivo TAL CUAL: una foto de celular de 6MB viajaba entera,
 * se guardaba entera y se volvia a descargar entera cada vez que alguien abria
 * la conversacion. Ese es el costo que este archivo corta.
 *
 * ── Por que en el navegador y no en el servidor ─────────────────────────────
 *   1. El original viajaria igual por la red de quien sube. Comprimiendo antes,
 *      suben ~300KB en vez de 6MB.
 *   2. `sharp` es un binario pesado que engorda la serverless function y su
 *      arranque en frio.
 *   3. La transformacion de imagenes de Supabase es un add-on de pago por
 *      imagen servida: cobraria justo por lo que se queria ahorrar.
 *
 * El canvas hace el mismo trabajo, gratis, en la maquina de quien sube. El
 * servidor sigue validando el tamaño final, asi que un cliente manipulado que
 * se salte la compresion se topa con el mismo tope.
 *
 * ── Que NO hace ─────────────────────────────────────────────────────────────
 * No toca PDFs, videos ni documentos: comprimirlos requiere codecs que el
 * navegador no expone. Para esos el unico control sigue siendo el tope de peso.
 * Tampoco toca GIF: recodificarlo en canvas mata la animacion y deja un solo
 * cuadro, que es peor que el archivo original.
 */

/** Lado mayor por defecto de una imagen de chat o adjunto. Cubre pantalla completa en retina. */
export const SHARED_IMAGE_MAX_EDGE = 1920

/** Presupuesto de bytes por defecto del resultado comprimido. */
export const SHARED_IMAGE_MAX_BYTES = 1200 * 1024

/**
 * Tope de lo que se ACEPTA comprimir, antes de tocar el canvas. No es un limite
 * de producto sino de memoria: decodificar una imagen de 60MP puede tumbar la
 * pestaña en un equipo modesto. Por encima de esto se sube el original y que
 * decida el tope del servidor.
 */
export const COMPRESSIBLE_SOURCE_MAX_BYTES = 40 * 1024 * 1024

/**
 * Debajo de esto no vale la pena recodificar: el ahorro es ruido y la
 * recodificacion siempre degrada un poco.
 */
export const COMPRESSION_FLOOR_BYTES = 200 * 1024

/** Escala manteniendo proporcion, sin agrandar nunca una imagen chica. */
export function fitWithin(width: number, height: number, maxEdge: number) {
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
 * Codifica bajando CALIDAD hasta entrar en el presupuesto de bytes, y solo si
 * eso no alcanza recorta el lado mayor.
 *
 * El orden importa: una captura de pantalla aguanta mucha compresion sin
 * volverse ilegible, mientras que quitarle pixeles si borra el texto, que suele
 * ser justo lo que la persona queria mostrar.
 *
 * Devuelve null si el navegador no sabe escribir ese codec, para que quien
 * llama reintente con JPEG.
 */
export async function encodeWithinBudget(
  source: ImageBitmap,
  maxEdge: number,
  budget: number,
  mime: string,
): Promise<{ blob: Blob; width: number; height: number } | null> {
  let edge = maxEdge

  // Dos recortes de tamaño como mucho: si a 56% del lado y calidad minima aun no
  // entra, el presupuesto esta mal calibrado, no faltan intentos.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { width, height } = fitWithin(source.width, source.height, edge)

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

    for (const quality of [0.78, 0.68, 0.58, 0.48, 0.4]) {
      const blob = await canvasToBlob(canvas, mime, quality)
      if (!blob) return null
      // toBlob cambia de tipo en silencio si no sabe escribir el codec pedido.
      if (blob.type !== mime) return null
      if (blob.size <= budget) return { blob, width, height }
    }

    edge = Math.round(edge * 0.75)
  }

  return null
}

/** Formatos que se pueden recodificar sin perder algo que importe. */
function esComprimible(file: File): boolean {
  if (!file.type.startsWith('image/')) return false
  // GIF animado: recodificar deja un solo cuadro. SVG es vectorial, ya pesa poco
  // y rasterizarlo seria destruirlo.
  if (file.type === 'image/gif' || file.type === 'image/svg+xml') return false
  return true
}

export interface CompressOptions {
  maxEdge?: number
  maxBytes?: number
}

/**
 * Comprime una imagen para subirla. Devuelve un `File` nuevo listo para el
 * FormData.
 *
 * NUNCA lanza: si algo no se puede comprimir (no es imagen, es un GIF animado,
 * el navegador no tiene el codec, el archivo esta dañado) devuelve el ORIGINAL.
 * Es deliberado: comprimir es una optimizacion, no un requisito, y no debe
 * romper una subida que de otro modo habria funcionado.
 */
export async function compressImageForUpload(file: File, opts: CompressOptions = {}): Promise<File> {
  const maxEdge = opts.maxEdge ?? SHARED_IMAGE_MAX_EDGE
  const maxBytes = opts.maxBytes ?? SHARED_IMAGE_MAX_BYTES

  if (!esComprimible(file)) return file
  if (file.size > COMPRESSIBLE_SOURCE_MAX_BYTES) return file
  // Ya es chica: recodificar solo degradaria.
  if (file.size <= COMPRESSION_FLOOR_BYTES) return file

  let bitmap: ImageBitmap
  try {
    // `from-image` respeta la orientacion EXIF: sin esto, las fotos tomadas en
    // vertical con celular se suben acostadas.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    return file
  }

  try {
    // WebP primero (pesa ~30% menos que JPEG a calidad equivalente); JPEG es el
    // respaldo para navegadores que no saben codificarlo.
    for (const [mime, ext] of [
      ['image/webp', 'webp'],
      ['image/jpeg', 'jpg'],
    ] as const) {
      const out = await encodeWithinBudget(bitmap, maxEdge, maxBytes, mime)
      if (!out) continue
      // Si la "compresion" salio mas pesada que el original, gana el original.
      if (out.blob.size >= file.size) return file

      const base = file.name.replace(/\.[^.]+$/, '') || 'imagen'
      return new File([out.blob], `${base}.${ext}`, { type: mime, lastModified: Date.now() })
    }
  } catch {
    return file
  } finally {
    // Libera la memoria del decodificado sin esperar al recolector.
    bitmap.close()
  }

  return file
}

/** Formatea bytes para mensajes al usuario. */
export function formatoBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

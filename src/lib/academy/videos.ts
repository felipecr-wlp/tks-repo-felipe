/**
 * Galeria de videos de la Academia: tipos, constantes y logica pura.
 *
 * El binario vive en Storage (bucket privado `academy-videos`); aqui NO hay
 * nada de red ni de React, a proposito: el ordenamiento de la galeria y la
 * validacion de capitulos son las dos piezas con reglas de negocio, y por
 * estar aisladas se prueban sin montar nada (tests/academy-videos-logica).
 *
 * Streaming: se sirve el MP4 por URL firmada con rango (el <video> nativo pide
 * bytes con Range y Storage los honra), sin transcodificar ni HLS. Es el
 * intercambio consciente para uso interno; si el buffering en campo duele, el
 * origen se cambia a un servicio de streaming y ESTE modulo no se toca.
 */

/** Bucket privado. Sin policies de storage: todo acceso es por URL firmada. */
export const VIDEO_BUCKET = 'academy-videos'

/** Limite duro de subida (espejo del file_size_limit del bucket): 2GB. */
export const VIDEO_MAX_BYTES = 2 * 1024 * 1024 * 1024

/** Mimes de video aceptados (espejo del allowed_mime_types del bucket). */
export const VIDEO_MIME_ALLOWLIST = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
])

/** Mimes de miniatura aceptados. */
export const THUMB_MIME_ALLOWLIST = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** Un video se da por VISTO al cubrir esta fraccion de su duracion. */
export const FRACCION_COMPLETADO = 0.9

/** Capitulo: segundo de inicio + titulo. Se guarda como jsonb en la BD. */
export interface Capitulo {
  /** segundo de inicio, >= 0 */
  s: number
  /** titulo visible */
  t: string
}

export const MAX_CAPITULOS = 100
export const MAX_TITULO_CAPITULO = 120

/**
 * Valida y normaliza capitulos que llegan del cliente (o de la BD, que no los
 * re-valida: el CHECK de SQL seria una segunda implementacion de esta regla).
 * Devuelve null si la estructura no sirve; capitulos ordenados si sirve.
 *
 * Reglas: arreglo de {s, t}; s entero >= 0; t no vacio y acotado; sin segundos
 * repetidos (dos capitulos en el mismo instante no significan nada); tope de
 * MAX_CAPITULOS para que un payload hostil no infle la fila.
 */
export function validarCapitulos(x: unknown): Capitulo[] | null {
  if (!Array.isArray(x)) return null
  if (x.length > MAX_CAPITULOS) return null
  const limpios: Capitulo[] = []
  const vistos = new Set<number>()
  for (const c of x) {
    if (typeof c !== 'object' || c === null) return null
    const s = (c as Record<string, unknown>).s
    const t = (c as Record<string, unknown>).t
    if (typeof s !== 'number' || !Number.isInteger(s) || s < 0) return null
    if (typeof t !== 'string') return null
    const titulo = t.trim()
    if (titulo.length === 0 || titulo.length > MAX_TITULO_CAPITULO) return null
    if (vistos.has(s)) return null
    vistos.add(s)
    limpios.push({ s, t: titulo })
  }
  limpios.sort((a, b) => a.s - b.s)
  return limpios
}

/* ---- Filas de BD (espejo de las tablas) ---- */

export type EstadoVideo = 'draft' | 'live'

export interface VideoAcademia {
  id: string
  title: string
  description: string
  storage_path: string
  thumbnail_path: string | null
  duration_seconds: number | null
  chapters: Capitulo[]
  tags: string[]
  status: EstadoVideo
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface AvanceVideo {
  video_id: string
  last_position: number
  seconds_watched: number
  completed: boolean
  updated_at: string
}

/** Lo que la galeria necesita por tarjeta, ya cruzado con el avance propio. */
export interface VideoConAvance extends VideoAcademia {
  avance: AvanceVideo | null
}

export interface GaleriaOrdenada {
  /** Empezados y no terminados, el mas reciente primero. */
  continuar: VideoConAvance[]
  /** Sin empezar, el mas nuevo primero. */
  nuevos: VideoConAvance[]
  /** Terminados, el mas reciente primero. */
  vistos: VideoConAvance[]
}

/**
 * "Que ver hoy": la automatizacion de la galeria como REGLAS TRANSPARENTES,
 * no como caja negra. Tres carriles:
 *
 *   1. continuar: lo que empezaste y no terminaste, lo mas reciente primero
 *      (retomar cuesta menos que decidir).
 *   2. nuevos: lo que no has abierto, lo mas nuevo primero (lo que Ali sube
 *      hoy aparece arriba hoy, sin curaduria manual).
 *   3. vistos: lo terminado, al final (disponible para repasar, sin estorbar).
 *
 * Un avance de menos de UMBRAL_EMPEZADO segundos cuenta como "no empezado":
 * abrir un video por error no lo debe mover de carril.
 */
export const UMBRAL_EMPEZADO = 5

export function ordenarVideosParaUsuario(
  videos: readonly VideoAcademia[],
  avances: readonly AvanceVideo[],
): GaleriaOrdenada {
  const porVideo = new Map<string, AvanceVideo>()
  for (const a of avances) {
    // Con duplicados (no deberia haberlos: UNIQUE en BD) gana el mas reciente.
    const previo = porVideo.get(a.video_id)
    if (!previo || a.updated_at > previo.updated_at) porVideo.set(a.video_id, a)
  }

  const continuar: VideoConAvance[] = []
  const nuevos: VideoConAvance[] = []
  const vistos: VideoConAvance[] = []

  for (const v of videos) {
    const avance = porVideo.get(v.id) ?? null
    const conAvance: VideoConAvance = { ...v, avance }
    if (avance?.completed) {
      vistos.push(conAvance)
    } else if (avance && avance.seconds_watched >= UMBRAL_EMPEZADO) {
      continuar.push(conAvance)
    } else {
      nuevos.push(conAvance)
    }
  }

  continuar.sort((a, b) => (b.avance?.updated_at ?? '').localeCompare(a.avance?.updated_at ?? ''))
  nuevos.sort((a, b) => b.created_at.localeCompare(a.created_at))
  vistos.sort((a, b) => (b.avance?.updated_at ?? '').localeCompare(a.avance?.updated_at ?? ''))

  return { continuar, nuevos, vistos }
}

/**
 * Progreso visible de la tarjeta (0..100). Prefiere posicion/duracion; si no
 * hay duracion conocida, cae a completado si/no para no inventar un numero.
 */
export function porcentajeVisto(v: VideoConAvance): number {
  if (v.avance?.completed) return 100
  if (!v.avance || !v.duration_seconds || v.duration_seconds <= 0) return 0
  const pct = Math.round((v.avance.last_position / v.duration_seconds) * 100)
  return Math.min(99, Math.max(0, pct))
}

/**
 * "1:23", "01:23:45" o "83" -> segundos. null si no parsea. Inverso laxo de
 * formatearSegundos: acepta lo que una persona teclearia en el editor de
 * capitulos, no solo lo que la app imprime.
 */
export function parsearTiempo(texto: string): number | null {
  const limpio = texto.trim()
  if (limpio.length === 0) return null
  if (/^\d+$/.test(limpio)) return parseInt(limpio, 10)
  const partes = limpio.split(':')
  if (partes.length < 2 || partes.length > 3) return null
  if (partes.some((p) => !/^\d{1,2}$/.test(p))) return null
  const nums = partes.map((p) => parseInt(p, 10))
  // Minutos y segundos no pueden pasar de 59 cuando hay una unidad mayor.
  for (let i = 1; i < nums.length; i++) if (nums[i] > 59) return null
  return nums.reduce((acc, n) => acc * 60 + n, 0)
}

/** mm:ss o h:mm:ss para duraciones y capitulos. */
export function formatearSegundos(total: number): string {
  const s = Math.max(0, Math.floor(total))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const seg = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(seg).padStart(2, '0')}`
}

/**
 * Nombre de archivo saneado para el path de storage: sin traversal, sin
 * caracteres raros, acotado. Mismo espiritu que safeFileName de task-files
 * (no se importa de ahi para no acoplar la academia al modulo de tareas).
 */
export function nombreSeguro(nombre: string): string {
  const base = nombre.split(/[\\/]/).pop() ?? 'archivo'
  const limpio = base.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+/, '_')
  return limpio.slice(0, 120) || 'archivo'
}

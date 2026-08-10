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

/**
 * Una opcion de interaccion. Puede solo continuar, saltar a otro punto del
 * mismo video, o LLEVAR A OTRO VIDEO: eso ultimo es la ramificacion estilo
 * "elige tu propia aventura".
 */
export interface OpcionInteraccion {
  /** texto visible del boton */
  t: string
  /** id del video destino. Si esta, la opcion RAMIFICA. */
  go?: string
  /** segundo de arranque (del destino si hay `go`, si no de este mismo video) */
  at?: number
}

/**
 * Interaccion: pregunta anclada a un segundo del video. El reproductor pausa
 * al llegar a `s` y muestra las opciones. Dos modos, y los distingue la
 * PRESENCIA de `a`, no una bandera aparte (una bandera puede contradecir a
 * los datos; la forma de los datos no):
 *
 *   - `a` presente  -> QUIZ. Hay respuesta correcta; fallar no avanza.
 *   - `a` ausente   -> RAMIFICACION. No hay respuesta mala, cada opcion es
 *                      un camino. Es el modo tipo Bandersnatch.
 *
 * Los dos se combinan: una opcion incorrecta PUEDE mandar (`go`) a un video
 * de refuerzo en vez de solo regañar.
 */
export interface Interaccion {
  /** segundo donde el video se pausa y pregunta */
  s: number
  /** la pregunta, o el dilema en modo ramificacion */
  q: string
  /** opciones (2 a 6) */
  opts: OpcionInteraccion[]
  /** indice de la correcta. Ausente = ramificacion pura, sin respuesta mala. */
  a?: number
  /** explicacion al fallar (solo tiene sentido en modo quiz) */
  ex?: string
}

export const MAX_INTERACCIONES = 50
export const MAX_TEXTO_INTERACCION = 300

/** true si la interaccion es ramificacion pura (ninguna opcion es "la mala"). */
export function esRamificacion(it: Interaccion): boolean {
  return it.a === undefined
}

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Normaliza y valida. Acepta la forma corta (`opts: ['A','B']`, que es como
 * nacio) y la rica (`opts: [{t:'A', go:'<uuid>'}]`), y SIEMPRE devuelve la
 * rica: el reproductor no tiene que saber que existieron dos formas.
 */
export function validarInteracciones(x: unknown): Interaccion[] | null {
  if (!Array.isArray(x)) return null
  if (x.length > MAX_INTERACCIONES) return null
  const limpias: Interaccion[] = []
  const vistos = new Set<number>()
  for (const it of x) {
    if (typeof it !== 'object' || it === null) return null
    const r = it as Record<string, unknown>
    if (typeof r.s !== 'number' || !Number.isInteger(r.s) || r.s < 0) return null
    if (typeof r.q !== 'string') return null
    const q = r.q.trim()
    if (q.length === 0 || q.length > MAX_TEXTO_INTERACCION) return null
    if (!Array.isArray(r.opts) || r.opts.length < 2 || r.opts.length > 6) return null

    const opts: OpcionInteraccion[] = []
    for (const o of r.opts) {
      // Forma corta: solo texto.
      if (typeof o === 'string') {
        const limpio = o.trim()
        if (limpio.length === 0 || limpio.length > MAX_TEXTO_INTERACCION) return null
        opts.push({ t: limpio })
        continue
      }
      if (typeof o !== 'object' || o === null) return null
      const ro = o as Record<string, unknown>
      if (typeof ro.t !== 'string') return null
      const texto = ro.t.trim()
      if (texto.length === 0 || texto.length > MAX_TEXTO_INTERACCION) return null

      const opcion: OpcionInteraccion = { t: texto }
      if (ro.go !== undefined && ro.go !== null) {
        // Un destino que no es uuid nunca podria resolverse: seria un boton
        // que lleva a una pantalla de error. Se rechaza al escribir, no al
        // reproducir.
        if (typeof ro.go !== 'string' || !RE_UUID.test(ro.go)) return null
        opcion.go = ro.go
      }
      if (ro.at !== undefined && ro.at !== null) {
        if (typeof ro.at !== 'number' || !Number.isInteger(ro.at) || ro.at < 0) return null
        opcion.at = ro.at
      }
      opts.push(opcion)
    }

    // `a` opcional: su ausencia ES el modo ramificacion.
    let a: number | undefined
    if (r.a !== undefined && r.a !== null) {
      if (typeof r.a !== 'number' || !Number.isInteger(r.a) || r.a < 0 || r.a >= opts.length) return null
      a = r.a
    }

    const ex = typeof r.ex === 'string' && r.ex.trim().length > 0
      ? r.ex.trim().slice(0, MAX_TEXTO_INTERACCION)
      : undefined

    // Dos preguntas en el mismo segundo se taparian una a la otra.
    if (vistos.has(r.s)) return null
    vistos.add(r.s)

    const limpia: Interaccion = { s: r.s, q, opts }
    if (a !== undefined) limpia.a = a
    if (ex !== undefined) limpia.ex = ex
    limpias.push(limpia)
  }
  limpias.sort((a, b) => a.s - b.s)
  return limpias
}

/** Todos los ids de video a los que ramifica este video. Para validar destinos. */
export function destinosDeInteracciones(its: readonly Interaccion[]): string[] {
  const s = new Set<string>()
  for (const it of its) for (const o of it.opts) if (o.go) s.add(o.go)
  return Array.from(s)
}

/* ---- Filas de BD (espejo de las tablas) ---- */

export type EstadoVideo = 'draft' | 'live'

export interface StackAcademia {
  id: string
  title: string
  description: string
  accent: string
  position: number
  school_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

/**
 * Ruta de aprendizaje: la puerta de entrada a un arbol de videos ramificados
 * ("Bienvenido a tu primer día" -> concreto o asfalto -> subramas). El arbol
 * NO vive aqui, se deriva de los enlaces (ver lib/academy/rutas.ts).
 */
export interface RutaAcademia {
  id: string
  title: string
  description: string
  school_id: string | null
  /** Video por el que se entra. null = ruta descabezada, hay que repararla. */
  entry_video_id: string | null
  accent: string
  position: number
  status: EstadoVideo
  audience: 'todos' | 'perfiles' | 'personas'
  audience_profiles: string[]
  created_by: string | null
  created_at: string
  updated_at: string
}

/** Escuela de WLP Academy. El nivel de arriba de todo (estructura de Fred). */
export interface EscuelaAcademia {
  id: string
  /** '00', '100', ... '1300'. Texto porque '00' no sobrevive como entero. */
  code: string
  title: string
  description: string
  accent: string
  /** La escuela 00 la completa todo el mundo. */
  mandatory: boolean
  position: number
  created_at: string
  updated_at: string
}

export interface VideoAcademia {
  id: string
  title: string
  description: string
  storage_path: string
  thumbnail_path: string | null
  duration_seconds: number | null
  chapters: Capitulo[]
  interactions: Interaccion[]
  tags: string[]
  stack_id: string | null
  /** Quien lo ve. Ver lib/academy/visibilidad.ts. */
  audience: 'todos' | 'perfiles' | 'personas'
  audience_profiles: string[]
  /** Posicion en el diagrama de flujo. null = nunca se ha acomodado. */
  diagram_x: number | null
  diagram_y: number | null
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

export interface SeccionStack {
  /** null = videos sueltos, sin stack asignado. Van al final. */
  stack: StackAcademia | null
  videos: VideoConAvance[]
}

/**
 * Agrupa la galeria por stacks respetando `position` (y titulo como
 * desempate estable). Los stacks vacios NO se pintan: una seccion sin
 * tarjetas es una promesa, no contenido. Los videos sin stack quedan en una
 * seccion final con stack null.
 */
export function agruparPorStack(
  videos: readonly VideoConAvance[],
  stacks: readonly StackAcademia[],
): SeccionStack[] {
  const porStack = new Map<string, VideoConAvance[]>()
  const sueltos: VideoConAvance[] = []
  for (const v of videos) {
    if (v.stack_id === null) {
      sueltos.push(v)
      continue
    }
    const lista = porStack.get(v.stack_id)
    if (lista) lista.push(v)
    else porStack.set(v.stack_id, [v])
  }

  const orden = [...stacks].sort(
    (a, b) => a.position - b.position || a.title.localeCompare(b.title),
  )

  const secciones: SeccionStack[] = []
  for (const s of orden) {
    const lista = porStack.get(s.id)
    if (lista && lista.length > 0) secciones.push({ stack: s, videos: lista })
    porStack.delete(s.id)
  }
  // Videos cuyo stack ya no existe en la lista (carrera rara): tratarlos como
  // sueltos en vez de perderlos de la pantalla.
  for (const lista of porStack.values()) sueltos.push(...lista)
  if (sueltos.length > 0) secciones.push({ stack: null, videos: sueltos })
  return secciones
}

export interface SeccionEscuela {
  /** null = stacks sin escuela asignada. Van al final. */
  escuela: EscuelaAcademia | null
  secciones: SeccionStack[]
  /** Cuantos videos tiene la escuela entera, y cuantos vio la persona. */
  total: number
  vistos: number
}

/**
 * Agrupa la galeria en el arbol completo: Escuela -> Stack -> Video.
 *
 * DIFERENCIA DELIBERADA CON LOS STACKS: un stack vacio NO se pinta (una
 * seccion sin tarjetas es una promesa, no contenido), pero una ESCUELA vacia
 * SI se pinta. La lista de escuelas es el mapa de la universidad: ver
 * "Estimating & Preconstruction" todavia sin cursos informa; esconderla haria
 * creer que no existe. Por eso las vacias se devuelven con total 0 y la UI
 * las presenta como proximas.
 */
export function agruparPorEscuela(
  videos: readonly VideoConAvance[],
  stacks: readonly StackAcademia[],
  escuelas: readonly EscuelaAcademia[],
): SeccionEscuela[] {
  const secciones = agruparPorStack(videos, stacks)

  const porEscuela = new Map<string, SeccionStack[]>()
  const sinEscuela: SeccionStack[] = []
  for (const sec of secciones) {
    const escuelaId = sec.stack?.school_id ?? null
    if (escuelaId === null) {
      sinEscuela.push(sec)
      continue
    }
    const lista = porEscuela.get(escuelaId)
    if (lista) lista.push(sec)
    else porEscuela.set(escuelaId, [sec])
  }

  const cuenta = (ss: readonly SeccionStack[]) => {
    let total = 0
    let vistos = 0
    for (const s of ss) {
      total += s.videos.length
      vistos += s.videos.filter((v) => v.avance?.completed).length
    }
    return { total, vistos }
  }

  const orden = [...escuelas].sort(
    (a, b) => a.position - b.position || a.code.localeCompare(b.code),
  )

  const salida: SeccionEscuela[] = []
  for (const e of orden) {
    const ss = porEscuela.get(e.id) ?? []
    salida.push({ escuela: e, secciones: ss, ...cuenta(ss) })
    porEscuela.delete(e.id)
  }
  // Stacks cuya escuela ya no esta en la lista: al cajon de sueltos, no a la
  // basura.
  for (const ss of porEscuela.values()) sinEscuela.push(...ss)
  if (sinEscuela.length > 0) {
    salida.push({ escuela: null, secciones: sinEscuela, ...cuenta(sinEscuela) })
  }
  return salida
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

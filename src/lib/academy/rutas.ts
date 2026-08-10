/**
 * Arbol de una ruta de aprendizaje.
 *
 * El arbol NO esta guardado en ningun lado: se DERIVA caminando los `go` de
 * las interacciones, empezando por el video de entrada. Esa es la decision
 * central y vale la pena defenderla: si el arbol viviera en una tabla de
 * aristas, editar una pregunta y olvidar la tabla dejaria el mapa mintiendo
 * respecto a lo que de verdad pasa al reproducir. Derivandolo, el mapa no
 * puede desincronizarse porque es la misma fuente.
 *
 * LO QUE ESTO TIENE QUE AGUANTAR SIN ROMPERSE:
 *
 *  - CICLOS. "A pregunta -> B, B pregunta -> A" es una historia legitima
 *    (volver a repasar), y un recorrido ingenuo se cuelga para siempre. Se
 *    lleva un conjunto de visitados por RAMA, no global: un video que aparece
 *    en dos ramas distintas debe pintarse en las dos, pero volver a entrar a
 *    uno que ya esta en MI camino es el ciclo y ahi se corta.
 *  - PROFUNDIDAD. Un tope duro, por si alguien encadena cien videos.
 *  - DESTINOS MUERTOS. El video destino pudo borrarse despues de crear el
 *    enlace. Se marca como roto y se sigue, en vez de reventar el mapa.
 */
import type { Interaccion, VideoAcademia, AvanceVideo } from './videos'

/** Tope de profundidad. Mas alla de esto es un error de autoria, no un curso. */
export const PROFUNDIDAD_MAX = 25

export interface NodoRuta {
  /** El video de este paso. null si el enlace apunta a algo que ya no existe. */
  video: VideoAcademia | null
  /** id al que apuntaba el enlace (util cuando `video` es null). */
  videoId: string
  /** Texto de la opcion que trajo hasta aqui. null en la raiz. */
  etiqueta: string | null
  /** Profundidad, 0 = entrada. */
  nivel: number
  /** Ya lo vio la persona. */
  visto: boolean
  /** Este nodo ya aparecia en el camino: se corto para no dar vueltas. */
  ciclo: boolean
  hijos: NodoRuta[]
}

export interface ResumenRuta {
  raiz: NodoRuta | null
  /** Videos distintos alcanzables desde la entrada. */
  totalVideos: number
  /** De esos, cuantos vio la persona. */
  vistos: number
  /** Enlaces que apuntan a videos que ya no existen. */
  rotos: number
  /** Se toco el tope de profundidad (autoria sospechosa). */
  truncado: boolean
}

function destinosDe(it: readonly Interaccion[]): Array<{ id: string; etiqueta: string }> {
  const salida: Array<{ id: string; etiqueta: string }> = []
  for (const i of it) {
    for (const o of i.opts) {
      if (o.go) salida.push({ id: o.go, etiqueta: o.t })
    }
  }
  return salida
}

/**
 * Construye el arbol desde el video de entrada.
 *
 * @param entryId  video de entrada de la ruta
 * @param videos   catalogo completo (para resolver los destinos)
 * @param avances  avance de la persona, para marcar lo ya visto
 */
export function construirArbol(
  entryId: string | null,
  videos: readonly VideoAcademia[],
  avances: readonly AvanceVideo[],
): ResumenRuta {
  if (!entryId) return { raiz: null, totalVideos: 0, vistos: 0, rotos: 0, truncado: false }

  const porId = new Map(videos.map((v) => [v.id, v]))
  const completados = new Set(avances.filter((a) => a.completed).map((a) => a.video_id))

  const alcanzables = new Set<string>()
  let rotos = 0
  let truncado = false

  function nodo(
    videoId: string,
    etiqueta: string | null,
    nivel: number,
    enCamino: ReadonlySet<string>,
  ): NodoRuta {
    const video = porId.get(videoId) ?? null
    if (video === null) rotos += 1
    else alcanzables.add(videoId)

    const base: NodoRuta = {
      video,
      videoId,
      etiqueta,
      nivel,
      visto: completados.has(videoId),
      ciclo: false,
      hijos: [],
    }

    // Ciclo: este video ya esta en MI camino. Se pinta y se corta. El conjunto
    // es por rama a proposito: en otra rama el mismo video es contenido nuevo,
    // no un ciclo.
    if (enCamino.has(videoId)) return { ...base, ciclo: true }
    if (video === null) return base
    if (nivel >= PROFUNDIDAD_MAX) {
      truncado = true
      return base
    }

    const siguiente = new Set(enCamino)
    siguiente.add(videoId)
    base.hijos = destinosDe(video.interactions).map((d) =>
      nodo(d.id, d.etiqueta, nivel + 1, siguiente),
    )
    return base
  }

  const raiz = nodo(entryId, null, 0, new Set())
  const vistos = Array.from(alcanzables).filter((id) => completados.has(id)).length

  return { raiz, totalVideos: alcanzables.size, vistos, rotos, truncado }
}

/**
 * Siguiente paso sugerido: el primer video sin ver, EN PROFUNDIDAD.
 *
 * POR QUE EN PROFUNDIDAD Y NO A LO ANCHO. Esta es la decision que hace que la
 * ruta "te lleve por lo que quieres aprender" en vez de zarandearte. Alguien
 * que eligio Concreto y vio su introduccion espera continuar DENTRO de
 * concreto (el vaciado, el acabado). A lo ancho, el boton lo mandaria a la
 * introduccion de Asfalto, o sea a la rama que NO eligio: se sentiria como si
 * el curso no lo hubiera escuchado.
 *
 * Se probo a lo ancho primero y en la ruta real (bienvenida -> concreto ->
 * vaciado/acabado, asfalto -> tendido/compactacion) mandaba a Asfalto justo
 * despues de ver Concreto. Por eso el cambio.
 *
 * Devuelve null si ya vio todo lo alcanzable.
 */
export function siguientePaso(resumen: ResumenRuta): NodoRuta | null {
  const pila: NodoRuta[] = resumen.raiz ? [resumen.raiz] : []
  while (pila.length > 0) {
    const n = pila.shift()!
    if (n.video && !n.visto && !n.ciclo) return n
    // Los hijos AL FRENTE: se baja por la rama actual antes de mirar la de al
    // lado. Con push() en vez de unshift() esto se vuelve a lo ancho y
    // reaparece el sintoma de arriba.
    pila.unshift(...n.hijos)
  }
  return null
}

/**
 * Aplana el arbol para pintarlo como lista sangrada. Se salta la raiz porque
 * la pantalla ya la muestra aparte como "empezar aqui".
 */
export function aplanar(nodo: NodoRuta | null): NodoRuta[] {
  if (!nodo) return []
  const salida: NodoRuta[] = []
  for (const h of nodo.hijos) {
    salida.push(h)
    salida.push(...aplanar(h))
  }
  return salida
}

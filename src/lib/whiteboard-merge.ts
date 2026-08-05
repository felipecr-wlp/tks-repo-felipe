/**
 * Reconciliacion de dos versiones de la misma pizarra.
 *
 * POR QUE EXISTE. La pizarra se guarda como un documento entero: el cliente
 * serializa TODA la escena y la escribe. Con dos personas dibujando, el ultimo
 * en guardar reescribe el documento con solo lo suyo y el trabajo del otro
 * desaparece. No era un riesgo teorico con mala suerte: el handler de realtime
 * descartaba el cambio remoto que llegaba mientras el usuario dibujaba y nunca
 * lo volvia a pedir, asi que la perdida estaba garantizada, no era probable.
 *
 * Y se veia peor desde el otro lado: a quien perdia el trazo se le borraba de
 * la pantalla solo, sin error y sin aviso, porque despues le llegaba por
 * realtime la version del otro y se la aplicaba encima.
 *
 * QUE HACE. Junta las dos listas por `id` y de cada elemento se queda con la
 * `version` mas alta. Es el mismo criterio que usa Excalidraw internamente y
 * por eso cada elemento ya trae ese campo: no hay que inventar un reloj.
 *
 * POR QUE FUNCIONA CON LO BORRADO. Excalidraw no quita el elemento al borrarlo,
 * le pone `isDeleted: true` y le sube la `version`. Eso se guarda tal cual en
 * la base (verificado: de 231 elementos de una pizarra real, 145 son borrados).
 * Asi que un borrado es un cambio mas y gana por version, igual que un trazo
 * nuevo. Sin esto habria que adivinar, y la unica forma de adivinar seria
 * resucitar lo que alguien acababa de borrar.
 *
 * QUE NO HACE. No es un CRDT. Si dos personas mueven EL MISMO elemento a la
 * vez, gana uno de los dos, el de version mas alta. Eso es aceptable y es lo
 * que hace todo el mundo: lo que no es aceptable es que gane uno y el otro
 * pierda ademas todo lo demas que dibujo.
 */

/** Lo minimo que se le pide a un elemento. El resto no se toca ni se mira. */
export interface ElementoConVersion {
  id?: unknown
  version?: unknown
  [k: string]: unknown
}

export interface ResultadoFusion<T> {
  /** La escena reconciliada. Es la misma referencia si no hubo nada que traer. */
  elementos: readonly T[]
  /**
   * Si entro algo del remoto. Solo cuando es true hay que repintar el lienzo,
   * y eso importa: `updateScene` dispara `onChange`, o sea otro ciclo de
   * guardado. Repintar "por si acaso" seria un bucle de escrituras.
   */
  cambio: boolean
}

/**
 * Version comparable. Lo que no sea numero vale menos que cualquier numero,
 * nunca mas: ante un elemento malformado la duda se resuelve conservando lo
 * que ya estaba, no pisandolo.
 */
function versionDe(el: ElementoConVersion): number {
  return typeof el.version === 'number' && Number.isFinite(el.version) ? el.version : -1
}

/** Solo sirve de llave un id que sea texto no vacio. */
function idDe(el: ElementoConVersion): string | null {
  return typeof el.id === 'string' && el.id.length > 0 ? el.id : null
}

/**
 * Fusiona la escena local con una remota.
 *
 * @param locales  lo que hay en el lienzo de quien esta guardando. Manda en
 *                 caso de empate: si ambos tienen la misma version, el elemento
 *                 es el mismo y no vale la pena repintar.
 * @param remotos  lo que llego por realtime mientras se dibujaba.
 */
export function fusionarElementos<T extends ElementoConVersion>(
  locales: readonly T[],
  remotos: readonly T[]
): ResultadoFusion<T> {
  if (!Array.isArray(remotos) || remotos.length === 0) {
    return { elementos: locales, cambio: false }
  }
  if (!Array.isArray(locales) || locales.length === 0) {
    // Sin nada local no hay nada que perder: entra el remoto completo. Ojo, esto
    // incluye el caso de la pizarra recien vaciada por otro.
    return { elementos: remotos, cambio: remotos.length > 0 }
  }

  // Se conserva el ORDEN local: en Excalidraw el orden del arreglo es el orden
  // de apilado (z-order). Reordenar aqui movería cosas de capa a espaldas de
  // quien dibuja, que es un cambio que nadie pidio.
  const salida = locales.slice()
  const posicionPorId = new Map<string, number>()
  locales.forEach((el, i) => {
    const id = idDe(el)
    // Con ids repetidos gana el primero; el segundo queda intocable, que es
    // preferible a escribir en el indice equivocado.
    if (id !== null && !posicionPorId.has(id)) posicionPorId.set(id, i)
  })

  let cambio = false

  for (const remoto of remotos) {
    const id = idDe(remoto)
    // Un elemento remoto sin id no se puede casar con nada. Agregarlo al final
    // lo duplicaria en cada fusion, asi que se ignora.
    if (id === null) continue

    const i = posicionPorId.get(id)
    if (i === undefined) {
      // No lo conocemos: es trabajo del otro que todavia no habiamos visto.
      posicionPorId.set(id, salida.length)
      salida.push(remoto)
      cambio = true
      continue
    }

    // Estrictamente mayor, no mayor o igual: con `>=` un remoto identico se
    // marcaria como cambio, se repintaria el lienzo y se volveria a guardar,
    // en bucle y sin que nada hubiera cambiado.
    if (versionDe(remoto) > versionDe(salida[i])) {
      salida[i] = remoto
      cambio = true
    }
  }

  return cambio ? { elementos: salida, cambio: true } : { elementos: locales, cambio: false }
}

/**
 * Saca los elementos de un contenido serializado de pizarra.
 * Devuelve arreglo vacio ante cualquier basura: un JSON corrupto de otro
 * cliente no puede impedir que yo guarde lo mio.
 */
export function elementosDeContenido<T extends ElementoConVersion>(contenido: string): readonly T[] {
  try {
    const escena = JSON.parse(contenido)
    const els = escena?.elements
    return Array.isArray(els) ? (els as T[]) : []
  } catch {
    return []
  }
}

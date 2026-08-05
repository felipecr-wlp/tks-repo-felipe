/**
 * Los seudonimos aplicados a un chat que responde en streaming.
 *
 * Los dos chats (KERN y BITACORA) son distintos del digest en dos cosas, y las
 * dos obligan a tocar mas que el prompt:
 *
 *   1. La respuesta llega a chorros. No hay un texto final donde deshacer la
 *      sustitucion de una vez, hay trozos que pueden partir "Persona 1" por la
 *      mitad. De eso se encarga `corteSeguro` en `seudonimos.ts`.
 *
 *   2. Tienen HERRAMIENTAS, y ahi la direccion importa. Cuando el modelo dice
 *      "apunta que Persona 2 cerro el sitio", eso acaba en la BASE DE DATOS. La
 *      base tiene que guardar el nombre real, no el seudonimo: si se guardara
 *      "Persona 2", el reporte quedaria escrito con numeros para siempre y no
 *      habria forma de recuperarlo. Asi que a la herramienta le entra el
 *      argumento REVELADO, y lo que devuelve se OCULTA antes de volver al
 *      modelo. La base ve nombres; el modelo, nunca.
 *
 * Regla que resume todo: lo que va hacia el MODELO se oculta, lo que va hacia la
 * BASE o hacia la PANTALLA se revela.
 */
import type { Seudonimos } from './seudonimos'

/** Forma minima de una herramienta del AI SDK, para no atarse a sus genericos. */
type HerramientaConEjecucion = {
  execute?: (args: never, opciones: never) => PromiseLike<unknown> | unknown
}

/**
 * Envuelve las herramientas para que el modelo hable en seudonimos y la base
 * siga viendo nombres reales.
 *
 * Si el sustituidor esta inerte devuelve las mismas herramientas sin envolver:
 * ni una funcion de mas en el camino cuando no hace falta.
 */
export function envolverHerramientas<T extends Record<string, unknown>>(
  herramientas: T,
  seudo: Seudonimos
): T {
  if (!seudo.activo) return herramientas

  const salida: Record<string, unknown> = {}

  for (const [nombre, herramienta] of Object.entries(herramientas)) {
    const h = herramienta as HerramientaConEjecucion
    if (typeof h?.execute !== 'function') {
      salida[nombre] = herramienta
      continue
    }

    const ejecutarOriginal = h.execute.bind(h)
    salida[nombre] = {
      ...(herramienta as object),
      execute: async (args: never, opciones: never) => {
        // Hacia la base: nombres reales.
        const argsReales = seudo.revelarProfundo(args)
        const resultado = await ejecutarOriginal(argsReales, opciones)
        // De vuelta al modelo: seudonimos.
        return seudo.ocultarProfundo(resultado)
      },
    }
  }

  return salida as T
}

/**
 * Deshace la sustitucion sobre el flujo de datos que va al navegador.
 *
 * El protocolo del AI SDK es una linea por parte, con un prefijo de un
 * caracter: `0:` texto, `9:` llamada a herramienta, `a:` resultado de la
 * herramienta. Eso es lo que hace viable traducir al vuelo: se puede trabajar
 * por lineas en vez de intentar entender un binario.
 *
 * Se traducen las tres, y las tres por el mismo motivo: todas terminan a la
 * vista. El texto es la respuesta; la llamada y el resultado alimentan la
 * interfaz del reporte, y si se dejaran en crudo la pantalla enseñaria
 * "Persona 2" donde debe ir el nombre de un compañero.
 */
export function revelarEnDataStream(
  respuesta: Response,
  seudo: Seudonimos
): Response {
  if (!seudo.activo || !respuesta.body) return respuesta

  const entrada = new TextDecoder()
  const salida = new TextEncoder()

  /** Lo que quedo de una linea a medias entre dos trozos de red. */
  let lineaIncompleta = ''
  /** Texto ya parseado que aun no se puede traducir sin arriesgarse. */
  let textoPendiente = ''

  /** Traduce lo que se pueda del texto acumulado y deja el resto para luego. */
  function emitirTexto(controlador: TransformStreamDefaultController<Uint8Array>, cerrando: boolean) {
    const corte = cerrando ? textoPendiente.length : seudo.corteSeguro(textoPendiente)
    if (corte === 0) return
    const listo = seudo.revelar(textoPendiente.slice(0, corte))
    textoPendiente = textoPendiente.slice(corte)
    if (listo) controlador.enqueue(salida.encode(`0:${JSON.stringify(listo)}\n`))
  }

  function procesarLinea(controlador: TransformStreamDefaultController<Uint8Array>, linea: string) {
    const corte = linea.indexOf(':')
    const prefijo = corte > 0 ? linea.slice(0, corte) : ''
    const cuerpo = corte > 0 ? linea.slice(corte + 1) : ''

    if (prefijo === '0') {
      // El texto no se traduce linea a linea: se acumula, porque un seudonimo
      // puede venir repartido entre dos partes consecutivas.
      try {
        textoPendiente += JSON.parse(cuerpo) as string
      } catch {
        // Si no es JSON valido no se toca: mejor pasarlo tal cual que romper el
        // stream por intentar arreglarlo.
        controlador.enqueue(salida.encode(linea + '\n'))
        return
      }
      emitirTexto(controlador, false)
      return
    }

    // Cualquier otra parte va en orden despues del texto que la precede, asi
    // que primero se vacia lo pendiente o la respuesta saldria desordenada.
    emitirTexto(controlador, true)

    if (prefijo === '9' || prefijo === 'a') {
      try {
        const dato = seudo.revelarProfundo(JSON.parse(cuerpo) as unknown)
        controlador.enqueue(salida.encode(`${prefijo}:${JSON.stringify(dato)}\n`))
        return
      } catch {
        // Igual que arriba: ante la duda, intacto.
      }
    }

    controlador.enqueue(salida.encode(linea + '\n'))
  }

  const transformador = new TransformStream<Uint8Array, Uint8Array>({
    transform(trozo, controlador) {
      lineaIncompleta += entrada.decode(trozo, { stream: true })
      const lineas = lineaIncompleta.split('\n')
      // La ultima puede estar a medias; se guarda para el siguiente trozo.
      lineaIncompleta = lineas.pop() ?? ''
      for (const linea of lineas) {
        if (linea === '') continue
        procesarLinea(controlador, linea)
      }
    },
    flush(controlador) {
      if (lineaIncompleta) procesarLinea(controlador, lineaIncompleta)
      emitirTexto(controlador, true)
    },
  })

  return new Response(respuesta.body.pipeThrough(transformador), {
    status: respuesta.status,
    statusText: respuesta.statusText,
    headers: respuesta.headers,
  })
}

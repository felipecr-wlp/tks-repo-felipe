/**
 * Reconciliacion de la pizarra entre dos personas dibujando a la vez.
 *
 * EL FALLO QUE ESTO EVITA. La pizarra se guarda como documento entero. Antes,
 * el cambio que llegaba por realtime mientras alguien dibujaba se DESCARTABA, y
 * acto seguido el guardado local reescribia el documento con solo lo suyo. El
 * trabajo del otro no se quedaba atras: desaparecia de la base. Y como despues
 * le llegaba de vuelta la version ganadora, tambien se le borraba de la
 * pantalla, sin error y sin aviso.
 *
 * A diferencia del otro tripwire de la pizarra, este SI ejecuta la logica: se
 * saco a `src/lib/whiteboard-merge.ts` justamente para poder probarla sin React
 * ni Excalidraw montado. Aqui no se comprueba que dos lineas esten en orden, se
 * comprueba que el trabajo de las dos personas sobreviva.
 *
 * Las versiones y el `isDeleted` no son invento del test: son campos que
 * Excalidraw ya pone en cada elemento y que se guardan tal cual (verificado en
 * la base de produccion, donde hay pizarras con mas elementos borrados que
 * vivos). Si eso dejara de ser cierto, esta estrategia deja de servir.
 */
import { describe, it, expect } from 'vitest'
import { fusionarElementos, elementosDeContenido } from '@/lib/whiteboard-merge'

/**
 * Un elemento de Excalidraw reducido a lo que la fusion mira. El resto de
 * campos (isDeleted, x, y...) entra por `extra` y el tipo los deja pasar: la
 * fusion no debe conocerlos, solo conservarlos.
 */
const el = (
  id: string,
  version: number,
  extra: Record<string, unknown> = {}
): { id: string; version: number; [k: string]: unknown } => ({ id, version, ...extra })

describe('Fusion de pizarra: nadie pierde su trabajo', () => {
  it('el caso real: dos personas dibujan a la vez y sobreviven los dos trazos', () => {
    // Ambos partieron del mismo fondo y cada quien agrego lo suyo.
    const fondo = el('fondo', 1)
    const locales = [fondo, el('trazo-mio', 1)]
    const remotos = [fondo, el('trazo-del-otro', 1)]

    const { elementos, cambio } = fusionarElementos(locales, remotos)
    const ids = elementos.map(e => e.id)

    expect(cambio).toBe(true)
    // Se listan los ids porque el fallo que importa es "falta uno", y asi el
    // mensaje de error dice cual falta en vez de un numero.
    expect(ids).toEqual(['fondo', 'trazo-mio', 'trazo-del-otro'])
  })

  it('un borrado del otro NO se resucita: gana por version, como cualquier cambio', () => {
    // Excalidraw no quita el elemento, le pone isDeleted y le sube la version.
    const locales = [el('caja', 3, { isDeleted: false })]
    const remotos = [el('caja', 4, { isDeleted: true })]

    const { elementos, cambio } = fusionarElementos(locales, remotos)

    expect(cambio).toBe(true)
    expect(elementos[0].isDeleted).toBe(true)
    // Y no se duplico al agregarlo "por si acaso".
    expect(elementos).toHaveLength(1)
  })

  it('un remoto viejo no pisa lo que acabo de hacer', () => {
    const locales = [el('caja', 9, { x: 100 })]
    const remotos = [el('caja', 2, { x: 0 })]

    const { elementos, cambio } = fusionarElementos(locales, remotos)

    expect(cambio).toBe(false)
    expect(elementos[0].x).toBe(100)
  })

  it('mismo contenido en ambos lados no cuenta como cambio (si contara, seria un bucle)', () => {
    // `cambio` es lo que decide si se repinta el lienzo, y repintar dispara otro
    // onChange y otro guardado. Marcar cambio sin cambio es una pizarra que se
    // guarda a si misma en circulo.
    const mismos = [el('a', 5), el('b', 7)]

    const { elementos, cambio } = fusionarElementos(mismos, mismos.map(e => ({ ...e })))

    expect(cambio).toBe(false)
    // Ademas devuelve la MISMA referencia: nada que repintar, nada que copiar.
    expect(elementos).toBe(mismos)
  })

  it('respeta el orden local, que en Excalidraw es el orden de las capas', () => {
    const locales = [el('atras', 1), el('enmedio', 1), el('adelante', 1)]
    const remotos = [el('enmedio', 2), el('nuevo', 1)]

    const { elementos } = fusionarElementos(locales, remotos)

    expect(elementos.map(e => e.id)).toEqual(['atras', 'enmedio', 'adelante', 'nuevo'])
    // El actualizado se quedo en SU capa, no salto al final.
    expect(elementos[1].version).toBe(2)
  })

  it('sin remoto no toca nada y no obliga a repintar', () => {
    const locales = [el('a', 1)]

    expect(fusionarElementos(locales, []).cambio).toBe(false)
    expect(fusionarElementos(locales, []).elementos).toBe(locales)
  })

  it('con el lienzo local vacio entra el remoto completo', () => {
    // Caso de quien acaba de abrir la pizarra mientras el otro ya dibujaba.
    const remotos = [el('a', 1), el('b', 1)]
    const { elementos, cambio } = fusionarElementos([], remotos)

    expect(cambio).toBe(true)
    expect(elementos).toHaveLength(2)
  })

  it('ante un elemento malformado conserva lo local en vez de pisarlo', () => {
    // Version que no es numero: la duda se resuelve a favor de lo que ya estaba.
    const locales = [el('caja', 1)]
    const remotos = [{ id: 'caja', version: 'nueva' as unknown as number }]

    const { elementos, cambio } = fusionarElementos(locales, remotos)

    expect(cambio).toBe(false)
    expect(elementos[0].version).toBe(1)
  })

  it('un remoto sin id se ignora en vez de duplicarse en cada fusion', () => {
    const locales = [el('a', 1)]
    const remotos = [{ version: 5 } as { id?: unknown; version?: unknown }]

    const primera = fusionarElementos(locales, remotos)
    const segunda = fusionarElementos(primera.elementos, remotos)

    expect(primera.elementos).toHaveLength(1)
    expect(segunda.elementos).toHaveLength(1)
  })
})

describe('Lectura del contenido remoto', () => {
  it('saca los elementos de una escena serializada', () => {
    const contenido = JSON.stringify({ elements: [el('a', 1)], appState: { theme: 'light' } })
    expect(elementosDeContenido(contenido)).toHaveLength(1)
  })

  it('un JSON corrupto de otro cliente no puede impedirme guardar lo mio', () => {
    // Devuelve vacio, no lanza: fusionar con vacio deja la escena local intacta.
    expect(elementosDeContenido('{roto')).toEqual([])
    expect(elementosDeContenido(JSON.stringify({ elements: 'no es arreglo' }))).toEqual([])
    expect(elementosDeContenido('null')).toEqual([])
  })
})

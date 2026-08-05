/**
 * La capa de seudonimos aplicada al STREAM y a las HERRAMIENTAS.
 *
 * `seudonimos.test.ts` prueba la sustitucion en si. Aqui se prueba lo otro, que
 * es donde de verdad se rompe: que la traduccion sobreviva a que la respuesta
 * llegue partida en trozos de red arbitrarios, y que la direccion sea la
 * correcta en las herramientas (a la base nombres reales, al modelo seudonimos).
 *
 * El peligro concreto que cubren estas pruebas es el mas silencioso de todos:
 * si un trozo corta "Persona 12" justo antes del "2", la cola "Persona 1" SI
 * matchea (el final de cadena satisface el limite) y se revelaria con el nombre
 * de OTRA persona. Un nombre real, bien escrito, en la frase de alguien mas:
 * nadie lo leeria como un error.
 */
import { describe, it, expect } from 'vitest'
import { crearSeudonimos } from '@/lib/ai/seudonimos'
import { envolverHerramientas, revelarEnDataStream } from '@/lib/ai/seudonimos-stream'

/** Arma una Response cuyo cuerpo emite exactamente los trozos dados. */
function respuestaCon(trozos: string[]): Response {
  const enc = new TextEncoder()
  return new Response(
    new ReadableStream<Uint8Array>({
      start(c) {
        for (const t of trozos) c.enqueue(enc.encode(t))
        c.close()
      },
    })
  )
}

async function leer(res: Response): Promise<string> {
  return await res.text()
}

/** Junta el texto de las partes `0:` de un data stream. */
function textoDe(stream: string): string {
  return stream
    .split('\n')
    .filter(l => l.startsWith('0:'))
    .map(l => JSON.parse(l.slice(2)) as string)
    .join('')
}

describe('revelarEnDataStream: el texto vuelve con nombres reales', () => {
  it('reconstruye el nombre aunque el seudonimo venga partido entre dos trozos de red', async () => {
    const s = crearSeudonimos(['Ana Perez', 'Luis Diaz'])
    // Corte a media LINEA. Lo resuelve el buffer de linea, antes de traducir.
    const res = revelarEnDataStream(
      respuestaCon(['0:"Perso', 'na 1 cerro el ticket"\n']),
      s
    )
    expect(textoDe(await leer(res))).toBe('Ana Perez cerro el ticket')
  })

  it('reconstruye el nombre repartido entre dos PARTES 0: consecutivas', async () => {
    const s = crearSeudonimos(['Ana Perez', 'Luis Diaz'])
    // Este es el caso de verdad: el modelo emite token a token, y cada token es
    // su propia parte `0:` ya completa. Aqui el buffer de linea no ayuda, porque
    // las dos lineas estan enteras; lo unico que evita revelar de mas es
    // `corteSeguro`, reteniendo el texto que todavia podria ser un seudonimo.
    const res = revelarEnDataStream(
      respuestaCon(['0:"Perso"\n', '0:"na 1 cerro el ticket"\n']),
      s
    )
    expect(textoDe(await leer(res))).toBe('Ana Perez cerro el ticket')
  })

  it('no confunde Persona 1 con Persona 12 cuando el digito llega despues', async () => {
    // Doce nombres: existen a la vez Persona 1 y Persona 12. Si el stream
    // revelara en cuanto ve "Persona 1", saldria el nombre de OTRA persona
    // seguido de un "2" suelto.
    const nombres = Array.from({ length: 12 }, (_, i) => `Nombre${i + 1} Apellido${i + 1}`)
    const s = crearSeudonimos(nombres)

    // La expectativa NO se escribe a mano: el numero que le toca a cada quien
    // depende del orden interno del padron y fijarlo aqui seria atarse a un
    // detalle que puede cambiar sin que nada este mal. Lo que importa es la
    // propiedad: trocear el stream da lo mismo que traducir la frase entera.
    const esperado = s.revelar('Persona 12 reviso')

    // Partes `0:` separadas y completas: el numero llega en la SIGUIENTE parte,
    // asi que al procesar la primera el texto "Persona 1" ya esta entero y seria
    // revelable si nadie lo retuviera.
    const res = revelarEnDataStream(respuestaCon(['0:"Persona 1"\n', '0:"2 reviso"\n']), s)
    const obtenido = textoDe(await leer(res))

    expect(obtenido).toBe(esperado)
    // Y explicitamente: no es la lectura equivocada "Persona 1" + "2".
    expect(obtenido).not.toBe(s.revelar('Persona 1') + '2 reviso')
  })

  it('traduce las llamadas a herramienta (9:) y sus resultados (a:)', async () => {
    const s = crearSeudonimos(['Ana Perez'])
    const cuerpo =
      '9:{"toolName":"crear","args":{"quien":"Persona 1"}}\n' +
      'a:{"result":{"autor":"Persona 1"}}\n'
    const salida = await leer(revelarEnDataStream(respuestaCon([cuerpo]), s))
    // Ambas alimentan la pantalla del reporte: si salieran en crudo, el usuario
    // veria "Persona 1" donde va el nombre de su companero.
    expect(salida).toContain('"quien":"Ana Perez"')
    expect(salida).toContain('"autor":"Ana Perez"')
    expect(salida).not.toContain('Persona 1')
  })

  it('respeta el orden: el texto pendiente sale antes de la llamada que lo sigue', async () => {
    const s = crearSeudonimos(['Ana Perez'])
    const cuerpo = '0:"Persona 1 dijo"\n9:{"toolName":"x","args":{}}\n'
    const salida = await leer(revelarEnDataStream(respuestaCon([cuerpo]), s))
    expect(salida.indexOf('Ana Perez')).toBeLessThan(salida.indexOf('toolName'))
  })

  it('una linea que no es JSON valido pasa intacta en vez de romper el stream', async () => {
    const s = crearSeudonimos(['Ana Perez'])
    const salida = await leer(revelarEnDataStream(respuestaCon(['9:{roto\n']), s))
    expect(salida).toBe('9:{roto\n')
  })

  it('vacia lo que quedo pendiente al cerrar, aunque no termine en salto de linea', async () => {
    const s = crearSeudonimos(['Ana Perez'])
    // Sin \n final: si el flush no corriera, el ultimo texto se perderia.
    const salida = await leer(revelarEnDataStream(respuestaCon(['0:"Persona 1"']), s))
    expect(textoDe(salida)).toBe('Ana Perez')
  })

  it('si el sustituidor esta inerte devuelve la MISMA respuesta, sin envolver', () => {
    const inerte = crearSeudonimos([], false)
    const original = respuestaCon(['0:"hola"\n'])
    expect(revelarEnDataStream(original, inerte)).toBe(original)
  })
})

describe('envolverHerramientas: la base ve nombres, el modelo no', () => {
  it('a la herramienta le entran nombres reales y al modelo le vuelven seudonimos', async () => {
    const s = crearSeudonimos(['Ana Perez'])
    let vioLaHerramienta: unknown = null

    const envueltas = envolverHerramientas(
      {
        apuntar: {
          execute: async (args: { quien: string }) => {
            vioLaHerramienta = args
            return { guardadoPara: args.quien }
          },
        },
      },
      s
    )

    const tool = envueltas.apuntar as { execute: (a: unknown, o: unknown) => Promise<unknown> }
    const resultado = await tool.execute({ quien: 'Persona 1' }, {})

    // Hacia la base: el nombre real, o el reporte quedaria escrito con numeros
    // para siempre y no habria forma de recuperarlo.
    expect(vioLaHerramienta).toEqual({ quien: 'Ana Perez' })
    // De vuelta al modelo: seudonimo otra vez.
    expect(resultado).toEqual({ guardadoPara: 'Persona 1' })
  })

  it('una herramienta sin execute se deja pasar tal cual', () => {
    const s = crearSeudonimos(['Ana Perez'])
    const sinExecute = { descripcion: 'algo' }
    const envueltas = envolverHerramientas({ x: sinExecute }, s)
    expect(envueltas.x).toBe(sinExecute)
  })

  it('si el sustituidor esta inerte no envuelve nada', () => {
    const inerte = crearSeudonimos([], false)
    const originales = { x: { execute: async () => 'ok' } }
    expect(envolverHerramientas(originales, inerte)).toBe(originales)
  })
})

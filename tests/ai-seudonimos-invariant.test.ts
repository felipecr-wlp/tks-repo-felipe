/**
 * Tripwire de SEUDONIMIZACION HACIA EL MODELO (fuga de nombres del equipo).
 *
 * El proveedor de IA es una palanca (`IA_PROVEEDOR`). Hoy es Gemini; el dia que
 * sea DeepSeek, todo lo que se le mande sale del pais. La capa de seudonimos
 * (`src/lib/ai/seudonimos.ts`) existe para que los nombres del padron no viajen:
 * salen como "Persona N" y vuelven a su nombre real antes de tocar la base o la
 * pantalla.
 *
 * El riesgo que cubre este tripwire NO es que la capa este mal escrita (de eso
 * se encarga `tests/seudonimos.test.ts`, que la prueba a fondo). Es el otro, el
 * que ninguna prueba unitaria ve: que alguien agregue MAS ADELANTE una ruta
 * nueva que llame al modelo y sencillamente no la conecte. Esa ruta funcionaria
 * perfecto, pasaria code review, y estaria mandando nombres reales a China sin
 * que nadie se entere. Un silencio, exactamente del tipo que ya nos costo seis
 * semanas una vez.
 *
 * Contrato: TODO archivo de `src` que llame a `generateText(` o `streamText(`
 * DEBE (a) ocultar lo que va HACIA el modelo (`.ocultar(` u `.ocultarProfundo(`)
 * y (b) revelar lo que vuelve, sea texto de una sola pieza (`.revelar(`) o un
 * stream (`revelarEnDataStream`). Sin (a) se fugan los nombres; sin (b) el
 * usuario lee "Persona 1" en su propia nota.
 *
 * Deteccion estructural: se descubren los llamados al modelo recorriendo `src`,
 * no con una lista escrita a mano. Una ruta nueva cae aqui sola.
 *
 * Alcance honesto: esto verifica que el archivo USA la capa en ambos sentidos,
 * no que la haya aplicado al campo correcto. Es la granularidad que un escaneo
 * de texto puede sostener sin mentir, y ataca el fallo realista (olvidarla por
 * completo), no el rebuscado (aplicarla al argumento equivocado).
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB ni llama al modelo.
 *
 * Hoy 5 llamados (digest, ai/text, kern, agent de reportes, desglosar); los 5
 * conectados.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')

/** Archivos .ts/.tsx de todo src, sin node_modules. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/** Quien le habla al modelo. */
const LLAMA_AL_MODELO = /\b(generateText|streamText)\s*\(/
/** Hacia el modelo: se oculta. */
const OCULTA = /\.ocultar(Profundo)?\s*\(/
/** De vuelta a la base o a la pantalla: se revela (texto entero o stream). */
const REVELA = /\.revelar(Profundo)?\s*\(|revelarEnDataStream\s*\(/

function rel(file: string): string {
  return file.replace(process.cwd(), '').replace(/\\/g, '/')
}

describe('Invariante: todo camino hacia el modelo pasa por los seudonimos', () => {
  const llamadores = walk(SRC).filter(f => LLAMA_AL_MODELO.test(readFileSync(f, 'utf8')))

  const sinOcultar: string[] = []
  const sinRevelar: string[] = []

  for (const file of llamadores) {
    const src = readFileSync(file, 'utf8')
    if (!OCULTA.test(src)) sinOcultar.push(rel(file))
    if (!REVELA.test(src)) sinRevelar.push(rel(file))
  }

  it('el scan encuentra los llamados al modelo (no esta vacio)', () => {
    // Si esto baja de 5, o alguien borro una ruta, o el patron dejo de matchear
    // y el tripwire se volvio un semaforo siempre en verde, que es peor que no
    // tenerlo.
    expect(llamadores.length).toBeGreaterThanOrEqual(5)
  })

  it('lo que va hacia el modelo se oculta', () => {
    expect(sinOcultar.sort()).toEqual([])
  })

  it('lo que vuelve del modelo se revela', () => {
    expect(sinRevelar.sort()).toEqual([])
  })
})

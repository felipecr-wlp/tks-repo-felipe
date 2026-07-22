/**
 * Tripwire de COBERTURA DE RATE LIMIT EN MUTACIONES (anti brute-force / DoS /
 * spam de escritura, OWASP API4 Unrestricted Resource Consumption).
 *
 * Distinto de la presencia del gate de autorizacion (S55): aquel garantiza QUIEN
 * puede escribir; este garantiza CUANTO. Un handler de mutacion sin rate limit es
 * una boca abierta a tres abusos:
 *   - BRUTE FORCE: el POST de join de invite verifica un password; sin tope, un
 *     atacante prueba miles de combinaciones por segundo.
 *   - DoS / COSTO: un POST/PATCH sin freno permite martillar la DB y el runtime
 *     (memoria, maxDuration, factura) hasta tumbar el servicio.
 *   - SPAM: crear comentarios, notas o invites en masa satura a los usuarios y el
 *     almacenamiento.
 * La barrera es una sola linea al entrar al handler: `applyRateLimit(request, ...)`
 * que, si el cubo se agoto, corta con 429 ANTES de tocar sesion o DB.
 *
 * Contrato: en TODO route.ts, el cuerpo de CADA handler que muta estado
 * (export async function POST | PATCH | PUT | DELETE) debe llamar `applyRateLimit(`
 * en ESE MISMO cuerpo. Los GET (lectura) quedan fuera de alcance a proposito.
 *
 * Deteccion estructural: se trocea cada archivo por bloque de handler (de un
 * "export async function VERBO" al siguiente) y se analiza SOLO el bloque que muta,
 * para que un applyRateLimit de un handler hermano (p.ej. el GET) no tape un POST
 * sin freno en el mismo archivo.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los 111 handlers de mutacion llaman applyRateLimit; 0 sin freno. Un handler
 * de escritura nuevo sin rate limit cae aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api')

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const MUTATION_VERB = /^(POST|PATCH|PUT|DELETE)$/
const RATE_LIMIT = /applyRateLimit\(/

describe('Invariante: todo handler que muta estado aplica rate limit', () => {
  const files = walkRoutes(API)
  const mutationHandlers: string[] = []
  const missing: string[] = []

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')

    const marks: { verb: string; start: number }[] = []
    for (const m of src.matchAll(/export async function ([A-Z]+)\b/g)) {
      marks.push({ verb: m[1], start: m.index ?? 0 })
    }
    marks.forEach((mark, i) => {
      if (!MUTATION_VERB.test(mark.verb)) return
      const end = marks[i + 1]?.start ?? src.length
      const body = src.slice(mark.start, end)
      const id = `/src/app/api/${rel}:${mark.verb}`
      mutationHandlers.push(id)
      if (!RATE_LIMIT.test(body)) missing.push(id)
    })
  }

  it('el scan encuentra los handlers de mutacion (no esta vacio)', () => {
    expect(mutationHandlers.length).toBeGreaterThanOrEqual(80)
  })

  it('ningun handler de mutacion queda sin rate limit', () => {
    expect(missing.sort()).toEqual([])
  })
})

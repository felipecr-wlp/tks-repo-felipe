/**
 * Tripwire de TOPE DE PAGINACION EN LECTURAS (anti unbounded resource consumption,
 * OWASP API4 Unrestricted Resource Consumption / DoS por pagina gigante).
 *
 * Un handler que lee `?limit=` del query y lo pasa CRUDO a `.limit()` / `.range()`
 * de Supabase deja que el cliente pida 10 millones de filas de un tiro: satura
 * memoria, runtime (maxDuration, factura) y la DB. El freno es barato y obligatorio:
 * CLAMPAR el valor a un techo, `Math.min(Math.max(n, 1), TECHO)`, antes de tocar la
 * query. (Distinto del rate limit S66, que topa CUANTAS veces; esto topa QUE TAN
 * grande es cada lectura.)
 *
 * Contrato, dos aristas:
 *   A) TODO route.ts que lee un parametro de paginacion del query
 *      (`limit|per_page|perPage|pageSize|offset|count`) DEBE clamparlo con `Math.min(`
 *      en el mismo archivo. Un read de paginacion sin clamp es una pagina sin techo.
 *   B) ANTI-PATRON DIRECTO: ningun `.limit(` ni `.range(` recibe DIRECTO un
 *      `parseInt(`/`Number(` (es decir, un valor del query sin pasar por el clamp).
 *      El tope siempre va por una variable ya acotada o una constante del server.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los 3 reads de limit (messages, tasks/search, tasks/[id]/comments) clampan a
 * 100/20/100; los demas `.limit()` usan constantes del server. Un read nuevo sin
 * clamp, o un parseInt volcado directo al limit, cae aqui. Nunca un silencio.
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

const rel = (file: string) => file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')

// Lee un parametro de paginacion del query.
const PAGINATION_READ =
  /searchParams\.get\(['"](?:limit|per_page|perPage|pageSize|offset|count)['"]\)/
// El clamp obligatorio: un techo via Math.min.
const CLAMP = /Math\.min\(/
// Anti-patron: volcar un parseInt/Number del query DIRECTO al limit/range.
const RAW_PARSE_INTO_QUERY = /\.(?:limit|range)\(\s*(?:parseInt|Number)\(/

describe('Invariante: toda lectura paginada por query clampa su limit (anti DoS API4)', () => {
  const files = walkRoutes(API)
  const paginationReaders = files.filter(f => PAGINATION_READ.test(readFileSync(f, 'utf8')))

  it('el scan encuentra los readers de paginacion (no esta vacio)', () => {
    expect(paginationReaders.length).toBeGreaterThanOrEqual(3)
  })

  // Arista A: todo reader de paginacion clampa con Math.min.
  it('todo route.ts que lee un limit del query lo clampa con Math.min', () => {
    const gaps: string[] = []
    for (const file of paginationReaders) {
      if (!CLAMP.test(readFileSync(file, 'utf8'))) gaps.push(rel(file))
    }
    expect(gaps.sort()).toEqual([])
  })

  // Arista B: ningun .limit()/.range() recibe un parseInt/Number crudo del query.
  it('ningun .limit()/.range() recibe un parseInt/Number crudo', () => {
    const offenders: string[] = []
    for (const file of files) {
      if (RAW_PARSE_INTO_QUERY.test(readFileSync(file, 'utf8'))) offenders.push(rel(file))
    }
    expect(offenders.sort()).toEqual([])
  })
})

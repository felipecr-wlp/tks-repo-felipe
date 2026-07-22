/**
 * Tripwire de ESCAPE DE COMODINES LIKE (anti LIKE-injection / ReDoS-lite en la
 * busqueda, CWE-20 Improper Input Validation sobre un patron de base de datos).
 *
 * `%` y `_` son comodines de LIKE/ILIKE en Postgres. Si el texto del usuario llega
 * CRUDO a `.ilike(col, \`%${q}%\`)`, entonces:
 *   - una busqueda de "%" hace match con TODO (filtra de mas, expone filas),
 *   - un patron patologico "%_%_%_..." fuerza un backtracking caro en el motor de
 *     LIKE (escaneo lento, consumo de CPU: DoS por patron).
 * El freno es escapar `%` y `_` (anteponer `\`) ANTES de armar el patron. Los tres
 * buscadores (search global, tasks/search, y el tasks/search por proyecto) ya lo
 * hacen con `q.replace(/[%_]/g, ...)` y solo pasan la variable `escaped` a `.ilike(`.
 *
 * El test de comportamiento tasks-search-like-escape solo monta UNA ruta; este
 * invariante estructural fija el contrato en TODOS los `.ilike(`/`.like(` de la API,
 * presentes y futuros, sin montar rutas.
 *
 * Contrato, dos aristas:
 *   A) POSITIVO: todo route.ts que llama `.ilike(`/`.like(` DEBE escapar los comodines
 *      en el mismo archivo (`.replace(/[%_]/`). Un buscador sin escape es LIKE crudo.
 *   B) ANTI-PATRON: ningun `.ilike(`/`.like(` interpola el parametro de busqueda CRUDO
 *      (`${q}`); el patron siempre se arma sobre la variable ya escapada (`escaped`).
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los 7 `.ilike(` de la API (3 archivos) escapan y solo consumen `escaped`. Un
 * buscador nuevo sin escape, o un `${q}` volcado directo al LIKE, cae aqui. Nunca un
 * silencio.
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

// Una llamada LIKE/ILIKE de PostgREST.
const LIKE_CALL = /\.(?:ilike|like)\(/
// El escape obligatorio de comodines: replace del char class [%_].
const WILDCARD_ESCAPE = /\.replace\(\/\[%_\]\//
// Anti-patron: interpolar el parametro de busqueda crudo `q` dentro del LIKE.
const RAW_Q_INTO_LIKE = /\.(?:ilike|like)\([^)]*\$\{\s*q\s*[}.]/

describe('Invariante: todo LIKE/ILIKE escapa los comodines % y _ (anti LIKE-injection)', () => {
  const files = walkRoutes(API)
  const likeFiles = files.filter(f => LIKE_CALL.test(readFileSync(f, 'utf8')))

  it('el scan encuentra los buscadores con .ilike/.like (no esta vacio)', () => {
    expect(likeFiles.length).toBeGreaterThanOrEqual(3)
  })

  // Arista A: todo archivo que hace LIKE escapa los comodines en el mismo archivo.
  it('todo route.ts con .ilike/.like escapa % y _ (replace(/[%_]/)', () => {
    const gaps: string[] = []
    for (const file of likeFiles) {
      if (!WILDCARD_ESCAPE.test(readFileSync(file, 'utf8'))) gaps.push(rel(file))
    }
    expect(gaps.sort()).toEqual([])
  })

  // Arista B: ningun LIKE interpola el parametro de busqueda crudo (${q}).
  it('ningun .ilike/.like interpola el parametro de busqueda crudo', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        if (RAW_Q_INTO_LIKE.test(line)) offenders.push(`${rel(file)}:${i + 1}`)
      })
    }
    expect(offenders.sort()).toEqual([])
  })
})

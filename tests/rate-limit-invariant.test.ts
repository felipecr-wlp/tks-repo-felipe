/**
 * Tripwire de cobertura de rate limit (mismo espiritu que xss-invariant y
 * patch-strict-schema): TODA ruta mutante (POST / PATCH / PUT / DELETE) bajo
 * src/app/api debe llamar applyRateLimit dentro del cuerpo del handler. El rate
 * limit es la primera barrera anti abuso (brute force, spam, scraping); si un
 * handler nuevo nace sin el, este test lo caza antes de mergear.
 *
 * Se parsea el arbol de fuentes por bloques de handler (de un "export async
 * function VERBO" al siguiente), no monta rutas ni DB, asi que es determinista
 * y barato.
 *
 * Excepciones legitimas (no son mutaciones con sesion de usuario que rate-limitar
 * en el mismo patron): webhooks/cron con su propio secreto, y callbacks OAuth.
 * Si alguna aplica, se declara aqui de forma explicita para que la lista blanca
 * sea visible y auditable, nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EXENCIONES_RATE_LIMIT, EXENTAS_REPO } from './helpers/rateLimitExempt'

const API = join(process.cwd(), 'src', 'app', 'api')

/** Recorre un dir y devuelve rutas absolutas de archivos route.ts. */
function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

// Rutas que NO usan applyRateLimit por diseño. La lista y la CONDICION que
// sostiene cada exencion viven en tests/helpers/rateLimitExempt.ts, compartidas
// con el tripwire hermano (rate-limit-coverage) para que las dos lecturas no se
// separen. Una exencion sin condicion comprobable no entra.
const ALLOWLIST = EXENTAS_REPO

const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/g

type Gap = { file: string; verb: string }

const files = walkRoutes(API)

describe('Invariante rate limit: todo handler mutante llama applyRateLimit', () => {
  const gaps: Gap[] = []
  for (const file of files) {
    const rel = file.replace(process.cwd(), '').replace(/\\/g, '/')
    if (ALLOWLIST.has(rel)) continue
    const src = readFileSync(file, 'utf8')

    // Indices de cada "export async function VERBO" para trocear por handler.
    const marks: { verb: string; start: number }[] = []
    for (const m of src.matchAll(/export async function ([A-Z]+)\b/g)) {
      marks.push({ verb: m[1], start: m.index ?? 0 })
    }
    marks.forEach((mark, i) => {
      if (!/^(POST|PATCH|PUT|DELETE)$/.test(mark.verb)) return
      const end = marks[i + 1]?.start ?? src.length
      const body = src.slice(mark.start, end)
      if (!/applyRateLimit\(/.test(body)) {
        gaps.push({ file: rel, verb: mark.verb })
      }
    })
  }

  it('encuentra handlers mutantes (el scan no esta vacio)', () => {
    // Recuento defensivo: si el walk se rompe, no queremos un verde falso.
    const totalMutating = files.reduce((n, f) => {
      const src = readFileSync(f, 'utf8')
      return n + (src.match(MUTATING)?.length ?? 0)
    }, 0)
    expect(totalMutating).toBeGreaterThanOrEqual(80)
  })

  it('ningun handler mutante carece de applyRateLimit', () => {
    expect(gaps.map(g => `${g.file} :: ${g.verb}`)).toEqual([])
  })

  it('el allowlist sigue siendo el mismo, y minimo', () => {
    expect([...EXENTAS_REPO].sort()).toEqual(['/src/app/api/workspaces/route.ts'])
  })

  it('cada exencion sigue cumpliendo la condicion que la justifica', () => {
    // Si la puerta cerrada de workspaces empezara a leer el cuerpo o a tocar la
    // base, deja de ser una respuesta constante y su exencion deja de ser cierta:
    // esto cae exigiendo un freno de verdad, en vez de callar.
    for (const e of EXENCIONES_RATE_LIMIT) {
      const src = readFileSync(join(process.cwd(), e.rel.replace(/^\//, '')), 'utf8')
      for (const { pieza, re } of e.condiciones) {
        expect(`${e.rel} ${pieza}: ${re.test(src)}`).toBe(`${e.rel} ${pieza}: true`)
      }
    }
  })
})

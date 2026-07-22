/**
 * Tripwire de COMPARACION EN TIEMPO CONSTANTE DE SECRETOS COMPARTIDOS (CWE-208
 * Observable Timing Discrepancy / timing side-channel).
 *
 * El `===` / `!==` de JS corta en la PRIMERA diferencia (y antes mide longitudes):
 * el tiempo de respuesta filtra cuantos bytes del secreto acerto quien lo prueba.
 * Sobre un secreto COMPARTIDO expuesto a input del atacante, eso abre, en teoria, la
 * recuperacion byte a byte por latencia. En este repo hay dos secretos asi:
 *   - El Bearer del CRON (`Authorization: Bearer <CRON_SECRET>`): protege endpoints
 *     que corren con SERVICE ROLE y bypassean RLS. El header es 100% del atacante.
 *   - El token de STATE de OAuth de Google (anti-CSRF): se compara el ?state de la
 *     URL de retorno contra la cookie del flujo.
 * La defensa es comparar ambos con `safeEqual` (SHA-256 a longitud fija + node
 * `timingSafeEqual`), nunca con `===`/`!==`. El hash de password ya usaba
 * `timingSafeEqual`; este invariante extiende la disciplina a los secretos de auth.
 *
 * Contrato, cuatro aristas:
 *   A) El helper `safeEqual` existe y es solido: usa `timingSafeEqual` de crypto
 *      sobre un digest de longitud fija (no compara las cadenas crudas).
 *   B) BAN DEL BEARER CRUDO: ningun route.ts compara `Bearer ${secret}` con
 *      `===`/`!==`. Todo archivo que arma ese Bearer usa `safeEqual(`.
 *   C) El compare del state de OAuth es constante: google/callback no usa
 *      `state === stateCookie` ni `!==`; usa `safeEqual(`.
 *   D) ANTI-REGRESION: los dos cron siguen siendo los unicos que arman un
 *      `Bearer ${secret}`, y ambos pasan por `safeEqual` (no reaparece el `!==`).
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los 3 compares de secreto (2 cron + OAuth state) corren en tiempo constante;
 * 0 comparaciones crudas. Revertir cualquiera a `===`/`!==` cae aqui. Nunca un
 * silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const API = join(SRC, 'app', 'api')
const HELPER = join(SRC, 'lib', 'secure-compare.ts')
const CALLBACK = join(API, 'google', 'callback', 'route.ts')

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const rel = (file: string) => file.replace(SRC, '').replace(/\\/g, '/')

// Arma el Bearer del cron a partir del secreto (indica un compare de secreto).
const BUILDS_BEARER = /`Bearer \$\{secret\}`/
// Comparacion CRUDA (no constante) del Bearer con ===/!==, en cualquier orden.
const RAW_BEARER_COMPARE =
  /(?:===|!==)\s*`Bearer \$\{secret\}`|`Bearer \$\{secret\}`\s*(?:===|!==)/
// Comparacion CRUDA del state de OAuth contra su cookie, en cualquier orden.
const RAW_STATE_COMPARE =
  /\bstate\s*(?:===|!==)\s*stateCookie\b|\bstateCookie\s*(?:===|!==)\s*state\b/
const USES_SAFE_EQUAL = /safeEqual\(/

describe('Invariante: los secretos compartidos se comparan en tiempo constante', () => {
  const files = walkRoutes(API)
  const bearerFiles = files.filter(f => BUILDS_BEARER.test(readFileSync(f, 'utf8')))

  it('el scan encuentra los archivos que arman el Bearer del cron (no esta vacio)', () => {
    expect(bearerFiles.length).toBeGreaterThanOrEqual(2)
  })

  // Arista A: el helper existe y usa timingSafeEqual sobre un digest fijo.
  it('safeEqual usa timingSafeEqual de crypto (no compara cadenas crudas)', () => {
    const src = readFileSync(HELPER, 'utf8')
    expect(src).toMatch(/timingSafeEqual/)
    expect(src).toMatch(/createHash\(['"]sha256['"]\)/)
    expect(src).toMatch(/export function safeEqual/)
  })

  // Arista B: nadie compara el Bearer crudo; todos usan safeEqual.
  it('ningun route.ts compara el Bearer del cron con === / !== crudo', () => {
    const offenders: string[] = []
    for (const file of files) {
      if (RAW_BEARER_COMPARE.test(readFileSync(file, 'utf8'))) offenders.push(rel(file))
    }
    expect(offenders.sort()).toEqual([])
  })

  it('todo archivo que arma un Bearer de cron usa safeEqual', () => {
    const gaps: string[] = []
    for (const file of bearerFiles) {
      if (!USES_SAFE_EQUAL.test(readFileSync(file, 'utf8'))) gaps.push(rel(file))
    }
    expect(gaps.sort()).toEqual([])
  })

  // Arista C: el state de OAuth se compara en tiempo constante.
  it('el callback de OAuth compara el state con safeEqual, no con === / !==', () => {
    const src = readFileSync(CALLBACK, 'utf8')
    expect(src).not.toMatch(RAW_STATE_COMPARE)
    expect(src).toMatch(USES_SAFE_EQUAL)
  })
})

/**
 * Tripwire de las CREDENCIALES del rate limit.
 *
 * Nace de un fallo real y silencioso: la base de Upstash estaba provisionada,
 * conectada al proyecto y en estado Available, pero el rate limiting seguia
 * apagado en produccion. El motivo era solo un nombre. La integracion de Upstash
 * del Marketplace de Vercel inyecta `KV_REST_API_URL` / `KV_REST_API_TOKEN`,
 * mientras que el modulo leia `UPSTASH_REDIS_REST_URL` / `_TOKEN`. El guard veia
 * las variables vacias, devolvia null y dejaba pasar TODO.
 *
 * Lo peligroso no fue el error, fue el silencio: la app respondia 200, el panel
 * de Vercel mostraba las variables presentes, el de Upstash mostraba la base
 * viva, y la unica pista era una linea de log entre miles. Un tripwire que
 * compara nombres cuesta milisegundos y cierra esa clase entera de fallo.
 *
 * Se vigilan tres aristas:
 *
 * ── A) Los nombres que el codigo lee ────────────────────────────────────────
 * Deben incluir los que Upstash inyecta de verdad. El alias nativo se conserva
 * para .env.local, pero el de produccion es el que manda.
 *
 * ── B) El token de SOLO LECTURA no se toca ──────────────────────────────────
 * La integracion inyecta ademas `KV_REST_API_READ_ONLY_TOKEN`, y es una trampa
 * perfecta: tiene el prefijo correcto y esta ahi al lado. Pero el rate limiter
 * ESCRIBE (incrementa contadores), asi que con ese token cada request lanzaria
 * y en produccion caeriamos al fail-closed: 429 para toda la app. Prohibido
 * nombrarlo en este modulo.
 *
 * ── C) Quedarse sin cuota NO puede tumbar la app ────────────────────────────
 * El plan free son 500K comandos al mes. Al agotarse, Upstash rechaza todo. Si
 * ese error cayera en el fail-closed, WLO entero devolveria 429 por una razon
 * administrativa, no por un ataque. Se prueba la FUNCION que separa "se acabo
 * la cuota" (dejar pasar) de "Redis se cayo" (fallar cerrado), no su texto.
 *
 * Determinista: lee la fuente y ejercita una funcion pura, no monta rutas ni DB
 * ni habla con Upstash.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isQuotaExhausted } from '@/lib/rate-limit'

const MODULE = join(process.cwd(), 'src', 'lib', 'rate-limit.ts')
const src = readFileSync(MODULE, 'utf8')

describe('Invariante de credenciales del rate limit: leer los nombres que Upstash realmente inyecta', () => {
  // ── A) los nombres ─────────────────────────────────────────────────────────
  it('lee los nombres que inyecta la integracion de Vercel', () => {
    expect(src).toMatch(/process\.env\.KV_REST_API_URL\b/)
    expect(src).toMatch(/process\.env\.KV_REST_API_TOKEN\b/)
  })

  it('conserva el alias nativo de Upstash para desarrollo local', () => {
    expect(src).toMatch(/process\.env\.UPSTASH_REDIS_REST_URL\b/)
    expect(src).toMatch(/process\.env\.UPSTASH_REDIS_REST_TOKEN\b/)
  })

  it('resuelve las credenciales en UN solo lugar', () => {
    // Dos caminos que leen env por separado es justo como nacio el bug: el guard
    // miraba unas variables y el cliente otras. Cada nombre aparece una sola vez.
    for (const name of [
      'KV_REST_API_URL',
      'KV_REST_API_TOKEN',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
    ]) {
      const veces = src.match(new RegExp(`process\\.env\\.${name}\\b`, 'g'))?.length ?? 0
      expect(`${name} leido ${veces} vez/veces`).toBe(`${name} leido 1 vez/veces`)
    }
    expect(src).toMatch(/function readRedisConfig\(\)/)
  })

  // ── B) el token de solo lectura ────────────────────────────────────────────
  it('NUNCA usa el token de solo lectura', () => {
    // El limiter escribe contadores. Con el READ_ONLY cada request lanzaria y el
    // fail-closed devolveria 429 a toda la app.
    expect(src).not.toMatch(/process\.env\.KV_REST_API_READ_ONLY_TOKEN/)
  })

  // ── C) cuota agotada distinta de Redis caido ───────────────────────────────
  it('reconoce los mensajes de cuota agotada de Upstash', () => {
    const cuota = [
      'ERR max daily request limit exceeded',
      'max requests limit exceeded',
      'You have exceeded your monthly quota',
      'ERR max requests limit exceeded. Please upgrade your plan.',
    ]
    for (const msg of cuota) {
      expect(`${msg} => ${isQuotaExhausted(new Error(msg))}`).toBe(`${msg} => true`)
    }
  })

  it('NO confunde una caida de Redis con quedarse sin cuota', () => {
    // Estos SI deben fallar cerrado: son incidentes acotados, no un estado
    // administrativo permanente. Tratarlos como cuota abriria la puerta justo
    // cuando no hay ninguna garantia anti-abuso.
    const caida = [
      'fetch failed',
      'ETIMEDOUT',
      'connect ECONNREFUSED 10.0.0.1:6379',
      'WRONGPASS invalid or missing auth token',
      'Unexpected end of JSON input',
    ]
    for (const msg of caida) {
      expect(`${msg} => ${isQuotaExhausted(new Error(msg))}`).toBe(`${msg} => false`)
    }
  })

  it('tolera que lo lanzado no sea un Error', () => {
    // @upstash/redis no garantiza el tipo de lo que lanza; si esto explotara,
    // el catch de applyRateLimit se romperia y el 429 nunca llegaria.
    expect(isQuotaExhausted('max requests limit exceeded')).toBe(true)
    expect(isQuotaExhausted(null)).toBe(false)
    expect(isQuotaExhausted(undefined)).toBe(false)
    expect(isQuotaExhausted({ codigo: 500 })).toBe(false)
  })

  // ── el fail-open de arranque sigue siendo intencional ──────────────────────
  it('sin credenciales deja pasar, y lo grita en los logs', () => {
    // Fallar cerrado por una variable que nunca se seteo dejaria la app entera
    // inutilizable (auth, invitaciones, join). Es un estado de deploy, no un
    // ataque. Pero tiene que ser RUIDOSO o vuelve a pasar desapercibido.
    expect(src).toMatch(/if \(!readRedisConfig\(\)\)/)
    expect(src).toMatch(/console\.error\(\s*'\[rate-limit\] KV_REST_API_URL\/TOKEN/)
  })
})

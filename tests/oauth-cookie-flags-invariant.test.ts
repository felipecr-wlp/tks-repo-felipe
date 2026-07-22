/**
 * Tripwire de FLAGS DE LA COOKIE DE CSRF DEL OAUTH (session fixation / robo del
 * token anti-CSRF por XSS o por canal inseguro).
 *
 * El flujo de OAuth de Google (independiente del login) se protege contra CSRF con
 * un `state` aleatorio: /google/connect lo genera, lo guarda en la cookie
 * `g_oauth_state`, y /google/callback lo revalida antes de aceptar el `code`. Esa
 * cookie es un SECRETO de sesion: si se puede leer o forjar, el atacante ata su
 * propia vuelta de OAuth a la victima (session fixation) o burla la revalidacion.
 * Tres flags la blindan:
 *   - httpOnly : el JS de la pagina NO puede leerla, asi un XSS no roba el state;
 *   - secure   : en produccion solo viaja por HTTPS, sin fuga por HTTP en claro;
 *   - sameSite : no se adjunta en navegaciones cross-site que no sean el retorno
 *     top-level del propio flujo (lax es lo correcto para un redirect de OAuth).
 * El `state` ademas se acuña con un CSPRNG (randomBytes), no con Math.random.
 *
 * Contrato, dos aristas:
 *   A) /google/connect setea la cookie del flujo con httpOnly:true, secure atado a
 *      produccion (NODE_ENV === 'production'), sameSite, y acuña el state con
 *      randomBytes.
 *   B) ANTI-REGRESION: el conjunto de route.ts que tocan `g_oauth_state` /
 *      `g_oauth_next` es EXACTAMENTE {connect, callback}. Un sitio nuevo que setee
 *      la cookie del flujo rompe el test y fuerza revisar sus flags.
 *
 * Determinista: solo lee fuentes, no monta rutas ni navegador.
 *
 * Hoy la cookie del flujo es httpOnly + secure(prod) + sameSite y el state es
 * randomBytes. Aflojar cualquiera cae aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const API = join(SRC, 'app', 'api')

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const CONNECT = join(API, 'google', 'connect', 'route.ts')
const TOUCHES_FLOW_COOKIE = /g_oauth_state|g_oauth_next/

// Solo estas dos rutas deben tocar la cookie del flujo de OAuth.
const REGISTRY = [
  '/app/api/google/callback/route.ts',
  '/app/api/google/connect/route.ts',
]

describe('Invariante: la cookie de CSRF del OAuth va httpOnly + secure + sameSite', () => {
  const connectSrc = readFileSync(CONNECT, 'utf8')

  // Arista A: los flags y la calidad del state en /google/connect.
  it('setea la cookie del flujo como httpOnly', () => {
    expect(connectSrc).toMatch(/httpOnly:\s*true/)
  })

  it('ata secure a produccion (no viaja en claro por HTTP)', () => {
    expect(connectSrc).toMatch(/secure:\s*process\.env\.NODE_ENV\s*===\s*['"]production['"]/)
  })

  it('declara sameSite en la cookie del flujo', () => {
    expect(connectSrc).toMatch(/sameSite:\s*['"](lax|strict)['"]/)
  })

  it('acuña el state anti-CSRF con un CSPRNG (randomBytes), no Math.random', () => {
    expect(connectSrc).toMatch(/randomBytes\(/)
    expect(/Math\.random\(/.test(connectSrc)).toBe(false)
  })

  // Arista B: nadie mas toca la cookie del flujo sin pasar por esta revision.
  it('solo connect y callback tocan la cookie del flujo de OAuth', () => {
    const discovered: string[] = []
    for (const file of walkRoutes(API)) {
      const src = readFileSync(file, 'utf8')
      if (!TOUCHES_FLOW_COOKIE.test(src)) continue
      discovered.push(file.replace(SRC, '').replace(/\\/g, '/'))
    }
    expect(discovered.sort()).toEqual([...REGISTRY].sort())
  })
})

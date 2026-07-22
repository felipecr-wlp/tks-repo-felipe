/**
 * Tripwire de EXPOSICION DE CAMPOS SENSIBLES (secret leak en la respuesta,
 * OWASP A02 Cryptographic Failures / A01 excessive data exposure).
 *
 * Tres columnas de la DB son SECRETOS que jamas deben volver al cliente en el
 * cuerpo de una respuesta:
 *   - password_hash : el hash PBKDF2 de la contraseña de un invite; filtrarlo
 *     permite crackearlo offline y redimir invites ajenos.
 *   - refresh_token : la llave de larga vida del OAuth de Google; con ella un
 *     atacante refresca access_tokens y lee el calendario del usuario indefinida-
 *     mente, incluso despues de que cierre sesion.
 *   - access_token  : el bearer de corta vida del mismo OAuth.
 * El peligro clasico es un handler que hace `select('*')` o devuelve la fila cruda
 * (`return NextResponse.json(invite)`) y arrastra el secreto sin querer.
 *
 * La postura correcta, que HOY cumple toda la superficie: el secreto se usa SOLO
 * server-side (verifyPassword, construir el cliente OAuth, persistir el refresh) y
 * a la respuesta va, como mucho, un DERIVADO no reversible (`has_password:
 * hash != null`) o se DESESTRUCTURA fuera (`map(({ password_hash, ...rest }) =>`).
 *
 * Contrato, dos aristas:
 *   A) ANTI-REGRESION ESTRUCTURAL: el conjunto de route.ts que menciona una columna
 *      secreta es EXACTAMENTE el registro conocido de abajo (6 rutas, todas
 *      auditadas). Una ruta nueva que toque un secreto rompe el test y fuerza
 *      revision consciente: si lo expone, hay que neutralizarlo; si es legitimo,
 *      registrarlo aqui.
 *   B) Los dos endpoints que MOLDEAN una respuesta con datos de invite exponen el
 *      DERIVADO booleano y nunca el hash crudo:
 *        - invites/[code]        -> `has_password: invite.password_hash != null`
 *        - workspaces/…/invites  -> `map(({ password_hash, ...rest })` + has_password
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 6 rutas tocan una columna secreta y 0 la devuelven cruda. Una ruta nueva que
 * filtre un secreto cae aqui. Nunca un silencio.
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

// Nombres de columna que son secretos: nunca deben volver crudos al cliente.
const TOUCHES_SECRET = /password_hash|refresh_token|access_token/

// Registro de rutas que legitimamente tocan una columna secreta (todas auditadas:
// la usan solo server-side y a la respuesta va, como mucho, un derivado).
//   - calendar/events        : lee tokens para construir el cliente OAuth; responde solo eventos.
//   - google/callback        : lee/escribe refresh_token; responde con un redirect (sin body).
//   - google/connect         : solo lo menciona en un comentario; responde con un redirect.
//   - invites/[code]/join    : lee password_hash solo para verifyPassword.
//   - invites/[code]         : lee password_hash; responde has_password (derivado).
//   - workspaces/…/invites   : lee password_hash; lo desestructura fuera antes de responder.
const REGISTRY: string[] = [
  '/app/api/calendar/events/route.ts',
  '/app/api/google/callback/route.ts',
  '/app/api/google/connect/route.ts',
  '/app/api/invites/[code]/join/route.ts',
  '/app/api/invites/[code]/route.ts',
  '/app/api/workspaces/[workspaceId]/invites/route.ts',
]

describe('Invariante: ninguna respuesta expone un campo secreto (hash de password / tokens OAuth)', () => {
  const files = walkRoutes(API)

  it('el scan encuentra la superficie de rutas (no esta vacio)', () => {
    expect(files.length).toBeGreaterThanOrEqual(60)
  })

  // Arista A: el conjunto de rutas que tocan un secreto es EXACTAMENTE el registro.
  it('toda ruta que toca una columna secreta esta en el registro auditado', () => {
    const discovered: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (!TOUCHES_SECRET.test(src)) continue
      discovered.push(file.replace(SRC, '').replace(/\\/g, '/'))
    }
    expect(discovered.sort()).toEqual([...REGISTRY].sort())
  })

  // Arista B: los dos endpoints que moldean respuesta con invite exponen el derivado.
  it('invites/[code] responde has_password derivado, nunca el hash crudo', () => {
    const src = readFileSync(join(API, 'invites', '[code]', 'route.ts'), 'utf8')
    expect(src).toMatch(/has_password:\s*invite\.password_hash\s*!=\s*null/)
  })

  it('workspaces/…/invites desestructura password_hash fuera y responde has_password', () => {
    const src = readFileSync(
      join(API, 'workspaces', '[workspaceId]', 'invites', 'route.ts'),
      'utf8'
    )
    expect(src).toMatch(/password_hash,\s*\.\.\.rest/)
    expect(src).toMatch(/has_password:\s*password_hash\s*!=\s*null/)
  })
})

/**
 * Tripwire de EXPOSICION DE COLUMNAS SENSIBLES (credential leak / broken object
 * property level authorization).
 *
 * Los tripwires S33-S45 cierran la AUTORIZACION (quien puede mutar/leer un
 * recurso). Este cierra un eje ortogonal: aunque el acceso al recurso sea
 * correcto, un handler puede filtrar en su RESPUESTA una columna secreta que
 * jamas debe salir del servidor (hash de password de un invite, tokens OAuth de
 * Google). Devolver esa columna en el JSON es fuga de credenciales de severidad
 * alta, aun sin IDOR.
 *
 * Regla: si un route.ts LEE una columna sensible de la DB (aparece dentro de un
 * `.select(...)`), el archivo DEBE demostrar manejo seguro con su PRIMITIVA: o la
 * mapea a un booleano (has_password), o la usa solo internamente (verifyPassword,
 * setCredentials del cliente OAuth), o la respuesta no es JSON del recurso
 * (redirect). Un archivo que lee una columna sensible y NO esta registrado aqui =
 * gap: hay que probar que no la devuelve, o registrarlo con su primitiva.
 *
 * Columnas sensibles vigiladas: password_hash, refresh_token, access_token,
 * token_hash, client_secret. (Los secretos de entorno como SUPABASE_SERVICE_ROLE_KEY
 * o CRON_SECRET se leen de process.env, no de la DB, y no entran aqui.)
 *
 * Registro archivo -> primitiva de manejo seguro:
 *   - invites/[code]                  -> has_password  (mapea el hash a booleano)
 *   - invites/[code]/join             -> verifyPassword (solo verifica, nunca lo
 *                                        devuelve)
 *   - workspaces/[workspaceId]/invites-> has_password  (destructura y descarta el
 *                                        hash antes de responder)
 *   - calendar/events                 -> setCredentials (los tokens solo alimentan
 *                                        el cliente OAuth; la respuesta es { events })
 *   - google/callback                 -> NextResponse.redirect (el refresh_token
 *                                        solo se persiste; la respuesta es un redirect)
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 5 archivos leen una columna sensible; los 5 la manejan de forma segura; 0
 * fugas. Un handler nuevo que lea una columna sensible debe registrarse aqui con
 * su primitiva de manejo seguro. Nunca un silencio.
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

// Una columna sensible LEIDA de la DB: aparece dentro de un `.select(...)`.
const SENSITIVE_SELECT =
  /\.select\([^)]*(password_hash|refresh_token|access_token|token_hash|client_secret)/

// Registro: archivo (ruta relativa a src/app/api) -> primitiva de manejo seguro.
const SAFE: Record<string, RegExp> = {
  'invites/[code]/route.ts':                    /has_password/,
  'invites/[code]/join/route.ts':               /verifyPassword\(/,
  'workspaces/[workspaceId]/invites/route.ts':  /has_password/,
  'calendar/events/route.ts':                   /setCredentials\(/,
  'google/callback/route.ts':                   /NextResponse\.redirect/,
}

describe('Invariante: ningun handler que lea una columna sensible la deja escapar en la respuesta', () => {
  const gaps: string[] = []
  const seen = new Set<string>()

  for (const file of walkRoutes(API)) {
    const src = readFileSync(file, 'utf8')
    if (!SENSITIVE_SELECT.test(src)) continue
    const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')
    seen.add(rel)
    const safe = SAFE[rel]
    if (!safe || !safe.test(src)) gaps.push('/src/app/api/' + rel)
  }

  it('encuentra los archivos que leen columnas sensibles (el scan no esta vacio)', () => {
    expect(seen.size).toBeGreaterThanOrEqual(5)
  })

  it('todo archivo que lee una columna sensible la maneja de forma segura (registrada)', () => {
    expect(gaps.sort()).toEqual([])
  })

  it('el registro SAFE no tiene entradas muertas (todas leen una columna sensible)', () => {
    const dead = Object.keys(SAFE).filter(f => !seen.has(f))
    expect(dead.sort()).toEqual([])
  })
})

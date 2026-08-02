/**
 * Tripwire de AUTENTICACION EN TODA MUTACION (Broken Access Control, OWASP A01).
 *
 * Toda operacion que ESCRIBE (POST / PATCH / PUT / DELETE) corre con el admin
 * client (service_role) que BYPASSA RLS, asi que la unica barrera que separa a un
 * anonimo de mutar la DB es el codigo del handler. Si un handler de mutacion
 * OLVIDARA leer la sesion, quedaria ABIERTO: cualquiera en internet podria crear,
 * editar o borrar filas de cualquier tenant sin login. Es la falla #1 del OWASP Top
 * 10. La defensa es un GATE de identidad al entrar: leer la sesion (getCachedUser /
 * getUser), exigir un usuario (requireUser), pasar por un gate de rol
 * (isWorkspaceAdminById), o, para un cron sin sesion, el secreto compartido
 * (CRON_SECRET).
 *
 * Deteccion estructural: se descubre TODO route.ts que exporte un handler de
 * mutacion y se exige que el archivo referencie AL MENOS una de las primitivas de
 * gate. Un handler de mutacion nuevo que no gatee la identidad cae aqui, sin
 * registro manual. Si aparece una primitiva de gate nueva (otro helper de acceso),
 * se agrega al conjunto de abajo de forma consciente.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 86 route.ts exportan una mutacion; los 86 gatean la identidad; 0 mutaciones
 * anonimas. Un handler de mutacion nuevo debe gatear. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { EXENCIONES_AUTH, EXENCIONES_REL_API } from './helpers/authExempt'

const API = join(process.cwd(), 'src', 'app', 'api')

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

// Un handler que ESCRIBE.
const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/

// Las primitivas de gate de identidad aceptadas (sesion, requireUser, gate de rol,
// o el secreto del cron). Todo handler de mutacion debe referenciar al menos una.
const AUTH_GATES = [
  /getCachedUser\(/,
  /getUser\(/,
  /requireUser\(/,
  /isWorkspaceAdminById\(/,
  /process\.env\.CRON_SECRET/,
]

describe('Invariante: todo handler de mutacion gatea la identidad antes de escribir', () => {
  const mutating: string[] = []
  const gaps: string[] = []

  for (const file of walkRoutes(API)) {
    const src = readFileSync(file, 'utf8')
    if (!MUTATING.test(src)) continue
    const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')
    mutating.push(rel)
    if (EXENCIONES_REL_API.has(rel)) continue // exencion condicional, se verifica abajo
    if (!AUTH_GATES.some((re) => re.test(src))) gaps.push('/src/app/api/' + rel)
  }

  it('el scan encuentra la superficie de mutacion (no esta vacio)', () => {
    expect(mutating.length).toBeGreaterThanOrEqual(60)
  })

  it('todo handler de mutacion referencia una primitiva de gate de identidad', () => {
    expect(gaps.sort()).toEqual([])
  })

  it('el allowlist de rutas sin sesion sigue siendo el mismo, y minimo', () => {
    // Si crece, es una decision consciente que hay que escribir aqui. Nunca un
    // archivo que se cuela porque alguien lo agrego "temporalmente".
    expect([...EXENCIONES_REL_API].sort()).toEqual([
      'connectors/call/[...action]/route.ts',
      'workspaces/route.ts',
    ])
  })

  it('cada exencion sigue cumpliendo la condicion que la justifica', () => {
    // Lo mismo que verifica auth-invariant, desde este lado: la lista es una sola
    // (tests/helpers/authExempt.ts) para que las dos lecturas no se separen.
    for (const e of EXENCIONES_AUTH) {
      const src = readFileSync(join(process.cwd(), e.rel.replace(/^\//, '')), 'utf8')
      for (const { pieza, re } of e.condiciones) {
        expect(`${e.rel} ${pieza}: ${re.test(src)}`).toBe(`${e.rel} ${pieza}: true`)
      }
    }
  })
})

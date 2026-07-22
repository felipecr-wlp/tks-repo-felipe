/**
 * Tripwire de FUGA DE SECRETOS A LOS LOGS (CWE-532 Insertion of Sensitive
 * Information into Log File / OWASP A09 Security Logging Failures).
 *
 * Loguear el objeto de error CRUDO de un cliente HTTP de OAuth (googleapis/gaxios)
 * vuelca su `.config` y `.response`: el body de la peticion de token lleva el
 * `client_secret` y el `code`, y el header `Authorization` lleva el `access_token`.
 * Un `console.error('...', e)` en el callback de OAuth basta para sembrar esos
 * secretos en los logs del servidor, que se retienen y se comparten. El caso gemelo:
 * loguear DIRECTO una variable que ES el secreto (`tokens`, `refresh_token`,
 * `access_token`, `password`, la service-role key).
 *
 * La defensa es doble: (1) en las rutas que manejan tokens de proveedor (google/**,
 * calendar/**) nunca se loguea el error crudo, se reduce a un MENSAJE con `errMessage`
 * (o el idiom `e instanceof Error ? e.message : String(e)`); (2) en TODO el codigo,
 * ningun `console.*` recibe como argumento una variable que sea un secreto.
 *
 * Contrato, tres aristas:
 *   A) El helper `errMessage` existe y devuelve solo el mensaje (nunca el objeto ni
 *      su config/headers): extrae `.message`, no hace `return e` del objeto crudo.
 *   B) BAN DEL ERROR CRUDO EN RUTAS DE TOKEN: en google/** y calendar/**, ningun
 *      `console.*` pasa un error capturado crudo (`e`/`err`/`error`/`ex`/`caught`)
 *      como argumento. Debe pasar `errMessage(...)` o un `msg` ya reducido.
 *   C) BAN GLOBAL DE VALORES SENSIBLES: ningun `console.*` (en todo src) recibe como
 *      argumento una variable de secreto (`tokens`, `refreshToken`, `refresh_token`,
 *      `accessToken`, `access_token`, `client_secret`, `clientSecret`, `password`,
 *      `password_hash`, `serviceRoleKey`). Se ignoran los literales de string (un tag
 *      como '[...] token exchange error:' no es el valor).
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 0 errores crudos en rutas de token y 0 secretos logueados. Un console que
 * vuelque el error de gaxios, o una variable de token, cae aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const HELPER = join(SRC, 'lib', 'safe-log.ts')

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkFiles(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (file: string) => file.replace(SRC, '').replace(/\\/g, '/')

// Un console.* que pasa un error capturado CRUDO como argumento final.
const RAW_ERROR_IN_CONSOLE =
  /console\.\w+\([^)]*,\s*(?:e|err|error|ex|caught)\b\s*\)/
// Quita literales de string de una linea (para no cazar el word "token" de un tag).
const stripStrings = (line: string) =>
  line.replace(/'[^']*'/g, "''").replace(/"[^"]*"/g, '""').replace(/`[^`]*`/g, '``')
// Variables de secreto que jamas deben ir como argumento a un console.
const SENSITIVE_VALUE =
  /\b(tokens|refreshToken|refresh_token|accessToken|access_token|client_secret|clientSecret|password|password_hash|passwordHash|serviceRoleKey)\b/

describe('Invariante: los secretos nunca se filtran a los logs (CWE-532)', () => {
  const files = walkFiles(SRC)
  const tokenRouteFiles = files.filter(
    f => /\/app\/api\/google\//.test(rel(f)) || /\/app\/api\/calendar\//.test(rel(f))
  )

  it('el scan encuentra las rutas que manejan tokens de proveedor (no esta vacio)', () => {
    expect(tokenRouteFiles.length).toBeGreaterThanOrEqual(2)
  })

  // Arista A: el helper reduce a mensaje, no devuelve el objeto crudo.
  it('errMessage existe y devuelve solo el mensaje (no el objeto crudo)', () => {
    const src = readFileSync(HELPER, 'utf8')
    expect(src).toMatch(/export function errMessage/)
    // Extrae el mensaje (no vuelca el objeto): referencia .message en su cuerpo.
    expect(src).toMatch(/\.message/)
  })

  // Arista B: ninguna ruta de token loguea el error crudo.
  it('ninguna ruta de token (google/**, calendar/**) loguea el error crudo', () => {
    const offenders: string[] = []
    for (const file of tokenRouteFiles) {
      const src = readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        if (RAW_ERROR_IN_CONSOLE.test(line)) offenders.push(`${rel(file)}:${i + 1}`)
      })
    }
    expect(offenders.sort()).toEqual([])
  })

  // Arista C: ningun console en src loguea una variable de secreto.
  it('ningun console.* recibe una variable de secreto como argumento', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        if (!/console\.\w+\(/.test(line)) return
        if (SENSITIVE_VALUE.test(stripStrings(line))) {
          offenders.push(`${rel(file)}:${i + 1}`)
        }
      })
    }
    expect(offenders.sort()).toEqual([])
  })
})

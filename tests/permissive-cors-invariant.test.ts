/**
 * Tripwire de CORS PERMISIVO (CWE-942 Permissive Cross-domain Policy with Untrusted
 * Domains).
 *
 * La API vive sobre el mismo origen que la app y su autenticacion es por cookie de
 * sesion Supabase (SameSite=Lax). Esa postura, HOY, hace que un sitio ajeno NO pueda
 * leer respuestas autenticadas ni forjar POST con la cookie: el navegador lo bloquea por
 * same-origin. Todo eso se ANULA en silencio si un handler responde con CORS abierto:
 *   - `Access-Control-Allow-Origin: *` deja que CUALQUIER pagina lea la respuesta JSON
 *     (fuga de datos cross-origin);
 *   - `Access-Control-Allow-Credentials: true` combinado con un origen comodin o
 *     reflejado convierte la cookie de sesion en una llave que cualquier sitio usa.
 * No hay CORS en la superficie actual (0 cabeceras ACAO/ACAC): la app se apoya en
 * same-origin + SameSite. Este tripwire fija esa suposicion para que nadie la afloje sin
 * querer en un refactor.
 *
 * Complementa `security-headers` (que vigila las 6 cabeceras de endurecimiento y la CSP,
 * NO el CORS).
 *
 * Contrato, dos aristas duras, sobre `src/**` y `next.config.mjs`:
 *   A) Ningun sitio pone `Access-Control-Allow-Origin` con valor comodin `*`.
 *   B) Ningun sitio pone `Access-Control-Allow-Credentials: true`.
 * Un CORS abierto nuevo cae aqui. Un CORS ACOTADO a un origen fijo NO calza el comodin y
 * es una decision consciente permitida (pero sin credentials:true).
 *
 * Determinista: solo lee fuentes, no monta el server.
 *
 * Hoy 0 cabeceras CORS. Un ACAO:* o ACAC:true nuevo cae aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

function walkSource(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkSource(full, out)
    else if (/\.(ts|tsx|js|mjs|jsx)$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (file: string) => file.replace(ROOT, '').replace(/\\/g, '/').replace(/^\//, '')

// ACAO con valor comodin `*` (permite cualquier origen leer la respuesta).
const ACAO_WILDCARD = /Access-Control-Allow-Origin['"\s]*[:,][^\n]*\*/i
// ACAC en true (expone la cookie de sesion a orígenes cruzados).
const ACAC_TRUE = /Access-Control-Allow-Credentials['"\s]*[:,][^\n]*true/i

describe('Invariante: la API nunca abre CORS permisivo (anti CWE-942)', () => {
  const files = walkSource(SRC)
  const config = join(ROOT, 'next.config.mjs')
  const scan = existsSync(config) ? [...files, config] : files

  it('el scan encuentra fuentes (no esta vacio)', () => {
    expect(scan.length).toBeGreaterThanOrEqual(20)
  })

  it('ningun sitio pone Access-Control-Allow-Origin con comodin *', () => {
    const offenders: string[] = []
    for (const file of scan) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (ACAO_WILDCARD.test(line)) offenders.push(`${rel(file)}:${i + 1}`)
      })
    }
    expect(offenders.sort()).toEqual([])
  })

  it('ningun sitio pone Access-Control-Allow-Credentials: true', () => {
    const offenders: string[] = []
    for (const file of scan) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (ACAC_TRUE.test(line)) offenders.push(`${rel(file)}:${i + 1}`)
      })
    }
    expect(offenders.sort()).toEqual([])
  })
})

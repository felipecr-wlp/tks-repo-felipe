/**
 * Tripwire de PARSEO DE BODY SIN GUARDA (robustez / disponibilidad, CWE-248
 * Uncaught Exception + CWE-703 Improper Check or Handling of Exceptional Conditions).
 *
 * `await request.json()` LANZA (SyntaxError) si el body no es JSON valido: vacio,
 * truncado, un `Content-Type` que miente, o basura enviada a proposito. Si esa
 * excepcion no se atrapa, el handler revienta y el framework responde un 500 opaco
 * (ruido en logs, posible fuga de stack, y un contrato de error inconsistente: unos
 * endpoints devuelven 400 y otros 500 ante el MISMO input malformado). Peor: un
 * cliente puede forzar 500s a voluntad mandando basura.
 *
 * La disciplina del repo es uniforme: cada lectura de body va PROTEGIDA, o con
 * `try { ... await request.json() ... } catch { -> 400 }`, o con el idiom
 * `await request.json().catch(() => null)` (y luego safeParse decide el 400/422).
 * Un body malformado SIEMPRE debe caer en un 400/422 limpio, nunca en un 500.
 *
 * Contrato, una arista dura:
 *   TODO `request.json()` en un route.ts de la API esta GUARDADO: o encadena
 *   `.catch(` en la misma linea, o esta dentro de un `try {` (en la misma linea o
 *   hasta 2 lineas arriba). Un parseo crudo sin guarda cae aqui.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los ~72 `request.json()` de la API estan todos guardados. Un parseo nuevo sin
 * try/catch ni .catch cae aqui. Nunca un silencio.
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

const PARSE = /request\.json\(\)/
const CATCH_ON_LINE = /request\.json\(\)\s*\.catch\(/
const OPENS_TRY = /\btry\s*\{/

// Una linea de parseo esta guardada si: encadena .catch( ahi mismo, o hay un
// `try {` en la misma linea o en alguna de las 2 lineas no vacias anteriores.
function isGuarded(lines: string[], i: number): boolean {
  const line = lines[i]
  if (CATCH_ON_LINE.test(line)) return true
  if (OPENS_TRY.test(line)) return true
  let seen = 0
  for (let j = i - 1; j >= 0 && seen < 2; j--) {
    if (lines[j].trim() === '') continue
    seen++
    if (OPENS_TRY.test(lines[j])) return true
  }
  return false
}

describe('Invariante: todo request.json() de la API va guardado (anti 500 por body malformado)', () => {
  const files = walkRoutes(API)
  const parseFiles = files.filter(f => PARSE.test(readFileSync(f, 'utf8')))

  it('el scan encuentra los route.ts que parsean body (no esta vacio)', () => {
    expect(parseFiles.length).toBeGreaterThanOrEqual(20)
  })

  // Arista dura: cada request.json() tiene su guarda (try/catch o .catch).
  it('ningun request.json() se parsea sin try/catch ni .catch', () => {
    const offenders: string[] = []
    for (const file of parseFiles) {
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!PARSE.test(line)) return
        if (!isGuarded(lines, i)) offenders.push(`${rel(file)}:${i + 1}`)
      })
    }
    expect(offenders.sort()).toEqual([])
  })
})

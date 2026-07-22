/**
 * Tripwire de VALIDACION DE FORMATO DEL PARAMETRO DE RUTA (input validation,
 * CWE-20 Improper Input Validation + robustez CWE-703 ante lo excepcional).
 *
 * Cada route.ts dinamico recibe su id por la URL (`params.taskId`, `params.noteId`,
 * ...). Ese id se pasa casi siempre CRUDO a un filtro de PostgREST sobre una columna
 * `uuid` (`.eq('id', params.taskId)`). Si el cliente manda basura que NO es un uuid
 * ("../../x", "abc", una comilla), Postgres NO devuelve "no encontrado": LANZA
 * `invalid input syntax for type uuid` (SQLSTATE 22P02), que el handler traduce a un
 * 500 opaco. Consecuencias:
 *   - contrato de error inconsistente (un id inexistente pero bien formado da 404,
 *     uno malformado da 500 ante el MISMO tipo de recurso),
 *   - ruido en logs y una via de enumeracion por diferencia de error,
 *   - un cliente puede forzar 500s a voluntad mandando ids basura.
 * El freno es barato y uniforme: VALIDAR el formato uuid del parametro ANTES de tocar
 * la DB, con `isUuid(params.<name>)` al principio del handler, y responder 422 limpio.
 *
 * La disciplina del repo ya es uniforme: TODO parametro de ruta que representa un uuid
 * se valida con `isUuid(params.<name>)` en su archivo (las rutas multi-parametro
 * validan cada uno: `isUuid(params.a) || isUuid(params.b)`). La unica excepcion legitima
 * es `[code]` de invites: es un codigo de union de texto libre, no un uuid, y se filtra
 * contra una columna de texto (`.eq('code', ...)`), sin restriccion de formato.
 *
 * Contrato, una arista dura:
 *   TODO parametro dinamico `[name]` en la ruta de un route.ts (salvo el allowlist de
 *   no-uuid) DEBE validarse con `isUuid(params.<name>)` en el mismo archivo. Un id de
 *   ruta que llega crudo a la DB sin validar su formato cae aqui.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los 77 route.ts con parametro validan cada uuid con isUuid; el unico no-uuid es
 * `code`. Un parametro nuevo sin guarda de formato cae aqui. Nunca un silencio.
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

// Parametros de ruta que NO son uuid por diseno (se validan por su propia semantica,
// no por formato uuid). `code` = codigo de invitacion de texto libre.
const NON_UUID_PARAMS = new Set<string>(['code'])

// Extrae los nombres de parametro dinamico de la ruta relativa: [taskId] -> taskId.
function paramsOf(relPath: string): string[] {
  const out: string[] = []
  const re = /\[([A-Za-z0-9_]+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(relPath)) !== null) out.push(m[1])
  return out
}

// Una guarda de formato para el parametro <name>: isUuid(params.<name>).
function hasUuidGuard(src: string, name: string): boolean {
  return new RegExp(`isUuid\\(\\s*params\\.${name}\\b`).test(src)
}

describe('Invariante: todo parametro de ruta uuid se valida con isUuid antes de tocar la DB (anti 500 22P02)', () => {
  const files = walkRoutes(API)
  const paramFiles = files.filter(f => paramsOf(rel(f)).length > 0)

  it('el scan encuentra los route.ts con parametro dinamico (no esta vacio)', () => {
    expect(paramFiles.length).toBeGreaterThanOrEqual(20)
  })

  // Arista dura: cada parametro uuid de la ruta tiene su isUuid(params.<name>).
  it('ningun parametro de ruta uuid llega a la DB sin validar su formato', () => {
    const offenders: string[] = []
    for (const file of paramFiles) {
      const r = rel(file)
      const src = readFileSync(file, 'utf8')
      for (const name of paramsOf(r)) {
        if (NON_UUID_PARAMS.has(name)) continue
        if (!hasUuidGuard(src, name)) offenders.push(`${r} (params.${name})`)
      }
    }
    expect(offenders.sort()).toEqual([])
  })
})

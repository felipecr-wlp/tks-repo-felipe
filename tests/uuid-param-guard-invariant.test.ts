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
import { parametroPasaPor } from './helpers/routeSource'

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

/**
 * Parametros que no son uuid pero SI tienen forma, y por tanto tienen guarda
 * propia. No es una exencion: se les exige su validador, solo que no es `isUuid`.
 *
 * `appId` = id de herramienta del marketplace. Es legible a proposito porque se
 * escribe en la URL (`/w/<ws>/apps/wli`), asi que jamas podria ser un uuid; lo
 * que no puede es ser texto libre camino a un `.eq('id', ...)`. Su guarda es
 * `isAppId` (ver src/lib/validation.ts).
 */
const GUARDA_PROPIA: Record<string, string> = { appId: 'isAppId' }

// Extrae los nombres de parametro dinamico de la ruta relativa: [taskId] -> taskId.
function paramsOf(relPath: string): string[] {
  const out: string[] = []
  const re = /\[([A-Za-z0-9_]+)\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(relPath)) !== null) out.push(m[1])
  return out
}

/*
 * Como se cuenta una guarda de formato para el parametro <name> (lo resuelve
 * `parametroPasaPor`):
 *
 * Cuenta la forma directa `isUuid(params.<name>)` y tambien la indirecta: el
 * handler entrega `params.<name>` a un helper del mismo archivo y ES ESE helper
 * quien valida. La segunda no es una concesion, es el patron correcto cuando dos
 * handlers comparten la resolucion del recurso:
 *
 *   async function resolve(request, imageId) { if (!isUuid(imageId)) return 422 ... }
 *   export async function DELETE(_r, { params }) { await resolve(r, params.imageId) }
 *
 * La correspondencia es POSICIONAL (ver tests/helpers/routeSource.ts): se valida
 * el parametro del helper que ocupa el mismo lugar. Un helper que valide otra
 * cosa NO da el visto bueno.
 */

describe('Invariante: todo parametro de ruta uuid se valida con isUuid antes de tocar la DB (anti 500 22P02)', () => {
  const files = walkRoutes(API)
  const paramFiles = files.filter(f => paramsOf(rel(f)).length > 0)

  it('el scan encuentra los route.ts con parametro dinamico (no esta vacio)', () => {
    expect(paramFiles.length).toBeGreaterThanOrEqual(20)
  })

  const offenders: string[] = []
  const verificados: string[] = []
  for (const file of paramFiles) {
    const r = rel(file)
    const src = readFileSync(file, 'utf8')
    for (const name of paramsOf(r)) {
      if (NON_UUID_PARAMS.has(name)) continue
      const guarda = GUARDA_PROPIA[name] ?? 'isUuid'
      if (parametroPasaPor(src, name, guarda)) verificados.push(`${r} (params.${name})`)
      else offenders.push(`${r} (params.${name} sin ${guarda})`)
    }
  }

  // Arista dura: cada parametro uuid de la ruta tiene su guarda de formato.
  it('ningun parametro de ruta uuid llega a la DB sin validar su formato', () => {
    expect(offenders.sort()).toEqual([])
  })

  it('la comprobacion no pasa en vacio (hay parametros efectivamente verificados)', () => {
    // Sin esto, el dia que `paramsOf` o la deteccion de guarda dejaran de
    // encontrar nada, `offenders` quedaria vacio y el tripwire se volveria verde
    // justo cuando deja de vigilar.
    expect(verificados.length).toBeGreaterThanOrEqual(60)
  })
})

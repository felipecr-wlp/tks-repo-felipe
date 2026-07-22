/**
 * Tripwire de INYECCION DE FILTRO POSTGREST (PostgREST filter injection).
 *
 * El operador `.or(...)` de supabase-js recibe un STRING con la mini gramatica de
 * filtros de PostgREST (`col.eq.valor,col2.is.null`). Ese string NO es una consulta
 * parametrizada: si se concatena un valor CRUDO del request dentro del `.or()`, un
 * atacante mete comas, puntos y operadores para REESCRIBIR el filtro. Ejemplo: un
 * `.or(\`name.eq.${q}\`)` con q = "x,visibility.eq.private" amplia el OR y expone
 * filas privadas. La misma trampa aplica al NOMBRE de una funcion `.rpc()`: si el
 * nombre se arma con un template, se puede invocar otra funcion.
 *
 * La postura correcta, que HOY cumple toda la superficie: dentro de un `.or()` solo
 * se interpola un valor de CONFIANZA (el id de la sesion `user.id`, una marca de
 * tiempo del server `nowIso`, o un `params.projectId` que el handler YA valido como
 * UUID, de modo que no puede contener metacaracteres del filtro), y todo `.rpc()`
 * usa un nombre de funcion ESTATICO con argumentos por nombre (parametrizados).
 *
 * Contrato, tres aristas:
 *   A) Toda expresion `${...}` interpolada dentro de un `.or(` pertenece al
 *      allowlist de expresiones de confianza.
 *   B) El unico handler que interpola un `params.*` en un `.or()` (task-templates)
 *      valida ese parametro con isUuid antes de usarlo.
 *   C) Ningun `.rpc()` arma su nombre de funcion con un template literal (backtick).
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB. Escaneo por linea; el estilo
 * del repo escribe cada `.or()` en una sola linea.
 *
 * Hoy 6 sitios `.or(` interpolan solo {user.id, nowIso, params.projectId} y 0 rpc
 * con nombre dinamico. Un `.or()` nuevo con input crudo cae aqui. Nunca un silencio.
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

// Expresiones de confianza que pueden interpolarse dentro de un `.or()`:
//   - user.id : UUID de la sesion autenticada
//   - nowIso  : timestamp ISO generado en el server
//   - params.projectId : validado con isUuid en su handler (arista B lo cubre)
const SAFE_INTERP = new Set(['user.id', 'nowIso', 'params.projectId'])

describe('Invariante: ningun filtro PostgREST (.or / .rpc) se arma con input crudo', () => {
  const files = walkRoutes(API)
  const interpViolations: string[] = []
  const rpcDynamic: string[] = []
  let orInterpSites = 0

  for (const file of files) {
    const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      // Arista A: interpolaciones dentro de un `.or(`.
      if (/\.or\(/.test(line) && line.includes('${')) {
        for (const m of line.matchAll(/\$\{([^}]*)\}/g)) {
          orInterpSites++
          const expr = m[1].trim()
          if (!SAFE_INTERP.has(expr)) {
            interpViolations.push(`/src/app/api/${rel}:${i + 1} -> \${${expr}}`)
          }
        }
      }
      // Arista C: nombre de funcion rpc armado con template literal.
      if (/\.rpc\(\s*`/.test(line)) {
        rpcDynamic.push(`/src/app/api/${rel}:${i + 1}`)
      }
    })
  }

  it('el scan encuentra los filtros .or interpolados (no esta vacio)', () => {
    expect(orInterpSites).toBeGreaterThanOrEqual(5)
  })

  it('toda interpolacion dentro de un .or() es una expresion de confianza', () => {
    expect(interpViolations.sort()).toEqual([])
  })

  it('el unico handler que interpola un params.* en .or() valida con isUuid', () => {
    const src = readFileSync(
      join(API, 'projects', '[projectId]', 'task-templates', 'route.ts'),
      'utf8'
    )
    expect(src).toMatch(/isUuid\(params\.projectId\)/)
  })

  it('ningun .rpc() arma su nombre de funcion con un template literal', () => {
    expect(rpcDynamic.sort()).toEqual([])
  })
})

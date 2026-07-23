/**
 * Tripwire de INYECCION DE COLUMNA DE ORDEN (sort/order-by injection, CWE-943 Improper
 * Neutralization of Special Elements in Data Query Logic).
 *
 * Hermano de `postgrest-filter-injection` (que blinda `.or()` y el nombre de `.rpc()`).
 * Este cubre una arista distinta y HOY sin tripwire: el argumento de `.order(...)`.
 *
 * En supabase-js, `.order('col')` NO es un valor parametrizado: es el NOMBRE de una
 * columna que va crudo a la clausula ORDER BY de PostgREST. Si ese nombre se arma con
 * input del cliente (`.order(req.nextUrl.searchParams.get('sort'))`, un template
 * `.order(\`${col}\`)`, o una variable derivada del request), un atacante ordena por
 * columnas que no deberia ver: puede INFERIR valores de campos sensibles observando el
 * orden (oraculo de ordenamiento), forzar errores por columnas inexistentes, o apuntar a
 * una tabla embebida para exfiltrar. La postura correcta, que hoy cumple toda la
 * superficie, es que la columna de orden sea SIEMPRE un literal estatico escrito por el
 * dev; si se necesita ordenar por eleccion del usuario, se mapea contra un allowlist
 * ANTES y se pasa el literal resultante, nunca el string crudo.
 *
 * Contrato, una arista dura:
 *   TODO `.order(` de la API recibe como primer argumento un STRING LITERAL (comilla
 *   simple o doble). Un `.order()` cuyo primer argumento sea un backtick, una variable o
 *   una expresion (cualquier cosa que no abra con `'` o `"`) cae aqui.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB. Escaneo por linea; el estilo del
 * repo escribe cada `.order()` en una sola linea con su columna literal.
 *
 * Hoy 59 sitios `.order()` en 45 route.ts, todos con columna literal. Un `.order()` nuevo
 * con columna dinamica cae aqui. Nunca un silencio.
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

// Captura el primer caracter no-espacio tras `.order(`. Seguro solo si abre comilla.
const ORDER_ARG = /\.order\(\s*(.)/g

describe('Invariante: ningun .order() de la API ordena por columna dinamica (anti sort injection / CWE-943)', () => {
  const files = walkRoutes(API)

  let orderSites = 0
  const offenders: string[] = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    src.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(ORDER_ARG)) {
        orderSites++
        const first = m[1]
        if (first !== "'" && first !== '"') {
          offenders.push(`${rel(file)}:${i + 1}`)
        }
      }
    })
  }

  it('el scan encuentra los .order() de la API (no esta vacio)', () => {
    expect(orderSites).toBeGreaterThanOrEqual(30)
  })

  // Arista dura: toda columna de orden es un literal estatico, nunca input del cliente.
  it('ningun .order() recibe una columna dinamica (no literal)', () => {
    expect(offenders.sort()).toEqual([])
  })
})

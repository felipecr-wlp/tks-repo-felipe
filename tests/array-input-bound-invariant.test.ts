/**
 * Tripwire de ARRAY DE ENTRADA SIN TECHO (anti unbounded resource consumption,
 * OWASP API4 Unrestricted Resource Consumption / DoS por payload gigante).
 *
 * Gemelo de ESCRITURA del tope de paginacion (S70, que topa la LECTURA). Un schema
 * zod `z.array(...)` sin `.max(N)` acepta un array de longitud arbitraria del body:
 * el cliente manda 10 millones de elementos, el runtime los parsea enteros a memoria
 * y (si el handler los persiste) los vuelca a la fila/JSON de la DB. Satura memoria,
 * runtime (maxDuration, factura) y almacenamiento. El freno es barato y obligatorio:
 * ACOTAR con `.max(N)` en el propio schema, antes de tocar la query.
 *
 * El caso real que motivo esto: el valor de un custom field multi_select se validaba
 * con `z.array(z.string())` SIN techo; `isValueValidForType` solo comprueba que cada
 * elemento sea una option id valida, nunca cuenta ni deduplica, asi que
 * `["opt1","opt1", ...x10M]` pasaba y se guardaba en el JSON `value`. Se acoto a
 * `.max(100)`.
 *
 * Contrato, una arista dura:
 *   TODO `z.array(` en un `route.ts` de la API DEBE llevar `.max(` acotandolo. Los
 *   schemas de body con arrays (attachments, mentions, conditions, actions, taskIds,
 *   options, statuses, ...) ya lo hacen; un array nuevo sin techo cae aqui.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los ~19 `z.array(` de la API estan todos acotados con `.max()`. Un array de
 * entrada sin techo cae aqui. Nunca un silencio.
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

// Un array de entrada de zod. El techo `.max(` puede ir encadenado en la misma linea
// (z.array(x).min(1).max(20)) o directamente (z.array(x).max(5)).
const ARRAY_DECL = /z\.array\(/
const HAS_MAX = /z\.array\([^\n]*?\)\s*(?:\.\w+\([^\n]*\))*?\.max\(/

describe('Invariante: todo z.array de entrada en la API lleva techo .max (anti DoS API4)', () => {
  const files = walkRoutes(API)
  const arrayFiles = files.filter(f => ARRAY_DECL.test(readFileSync(f, 'utf8')))

  it('el scan encuentra los route.ts con arrays de entrada (no esta vacio)', () => {
    expect(arrayFiles.length).toBeGreaterThanOrEqual(5)
  })

  // Arista dura: cada linea que declara un z.array( lleva su .max( en la misma linea.
  it('todo z.array( en la API esta acotado con .max(', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        if (!ARRAY_DECL.test(line)) return
        if (!HAS_MAX.test(line)) offenders.push(`${rel(file)}:${i + 1}`)
      })
    }
    expect(offenders.sort()).toEqual([])
  })
})

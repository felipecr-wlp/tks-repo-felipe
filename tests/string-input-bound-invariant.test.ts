/**
 * Tripwire de STRING DE ENTRADA SIN TECHO (anti unbounded resource consumption,
 * OWASP API4 Unrestricted Resource Consumption / CWE-770 Allocation of Resources
 * Without Limits or Throttling).
 *
 * Gemelo ESCALAR del tope de arrays (S71, que topa `z.array(...).max(N)`). Los Route
 * Handlers del App Router de Next NO imponen un limite de tamano de body por defecto
 * (a diferencia del viejo API de `pages`), asi que un campo de texto libre validado
 * con `z.string()` SIN `.max(N)` acepta una cadena de longitud arbitraria del body:
 * el cliente manda 50 MB en `content`/`value`/`due_date`, el runtime la bufferiza y
 * valida enteros a memoria y (si el handler la persiste) la vuelca a la fila/JSON de
 * la DB. Satura memoria, runtime (maxDuration, factura) y almacenamiento. El freno es
 * barato y obligatorio: ACOTAR con `.max(N)` en el propio schema, con un techo
 * generoso que jamas rechace un payload legitimo (p.ej. `.max(1_000_000)` para el
 * cuerpo de una nota, `.max(40)` para una fecha ISO).
 *
 * El caso real que motivo esto (S75): notes.content, whiteboards.content,
 * profile.avatar_url, marketplace.workspace_slug, sprints.start_date/end_date,
 * goals.due_date, tasks.sort_order, automations.value y el escalar de custom-fields
 * se validaban con `z.string()` pelon, SIN techo. Se acotaron todos.
 *
 * Un `z.string()` queda EXENTO si su longitud ya esta acotada en la misma linea, sea
 * por techo explicito (`.max(`, `.length(`) o por un validador de FORMATO que limita
 * la forma y con ella el tamano razonable (`.uuid(`, `.datetime(`, `.regex(`,
 * `.email(`, `.url(`). Un `.min(` NO acota (solo pone piso), asi que no exime.
 *
 * Contrato, una arista dura:
 *   TODO `z.string()` de un schema en un `route.ts` de la API DEBE llevar en su misma
 *   linea o un techo (`.max(`/`.length(`) o un validador de formato. Un string de
 *   entrada de texto libre sin techo cae aqui.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los ~72 route.ts con `z.string()` acotan cada campo de texto libre. Un string
 * de entrada sin techo cae aqui. Nunca un silencio.
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

// Una declaracion de string de zod.
const STRING_DECL = /z\.string\(\)/
// Acotado si, tras `z.string()`, en la MISMA linea encadena un techo o un validador de
// formato. `.min(` a proposito NO cuenta: pone piso, no techo.
const BOUNDED =
  /z\.string\(\)[^\n]*?\.(?:max|length|uuid|datetime|regex|email|url|ip|cuid2?|ulid|emoji)\(/

// Quita el comentario de linea para no exigir techo dentro de un `// ...`.
function code(line: string): string {
  const i = line.indexOf('//')
  return i === -1 ? line : line.slice(0, i)
}

describe('Invariante: todo z.string() de entrada en la API lleva techo .max/.length o validador de formato (anti DoS API4)', () => {
  const files = walkRoutes(API)
  const stringFiles = files.filter(f => STRING_DECL.test(readFileSync(f, 'utf8')))

  it('el scan encuentra los route.ts con strings de entrada (no esta vacio)', () => {
    expect(stringFiles.length).toBeGreaterThanOrEqual(20)
  })

  // Arista dura: cada linea que declara un z.string() lleva su techo o formato.
  it('todo z.string() de entrada en la API esta acotado (techo o formato)', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      src.split('\n').forEach((raw, i) => {
        const line = code(raw)
        if (!STRING_DECL.test(line)) return
        if (!BOUNDED.test(line)) offenders.push(`${rel(file)}:${i + 1}`)
      })
    }
    expect(offenders.sort()).toEqual([])
  })
})

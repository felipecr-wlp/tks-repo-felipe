/**
 * Tripwire de BODY SIN VALIDACION DE ESQUEMA (input validation en la puerta,
 * CWE-20 Improper Input Validation).
 *
 * Hermano de `body-parse-guard` (que solo exige que `request.json()` NO reviente ante
 * JSON malformado) y de los topes de tamano (S71 arrays, S75 strings). Este cubre el
 * escalon anterior a todos: que el body parseado se VALIDE contra un esquema zod antes
 * de usarse. Leer `body.foo` crudo, sin `schema.safeParse(body)`/`.parse(body)`, deja
 * pasar tipos inesperados, campos no acotados y ROLES/valores que el handler nunca
 * debio aceptar.
 *
 * El caso real que motivo esto (S76): el chat de KERN (`/api/kern`) tomaba
 * `messages = body.messages` crudo y lo pasaba al LLM. El `role` de cada mensaje no se
 * validaba, asi que un cliente podia mandar `{ role: 'system', content: '...' }` e
 * inyectar instrucciones de sistema, secuestrando el prompt de KERN (role/prompt
 * injection). Se acoto con un esquema zod que restringe el rol a 'user'/'assistant'.
 *
 * Contrato, una arista dura:
 *   TODO `route.ts` de la API que lee el body con `request.json()` DEBE validarlo con
 *   una llamada zod `.safeParse(` o `.parse(` en el mismo archivo. Un body que se lee
 *   crudo, sin pasar por un esquema, cae aqui.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los 71 route.ts que parsean body validan con un esquema zod. Un handler nuevo
 * que lea el body sin esquema cae aqui. Nunca un silencio.
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

const PARSES_BODY = /request\.json\(\)/
// Una validacion de esquema zod: schema.safeParse(...) o schema.parse(...). Se excluye
// `.json()` (respuesta) exigiendo el nombre exacto del metodo de zod.
const HAS_ZOD_PARSE = /\.(safeParse|parse)\(/

describe('Invariante: todo body de la API se valida con un esquema zod (anti CWE-20 en la puerta)', () => {
  const files = walkRoutes(API)
  const bodyFiles = files.filter(f => PARSES_BODY.test(readFileSync(f, 'utf8')))

  it('el scan encuentra los route.ts que parsean body (no esta vacio)', () => {
    expect(bodyFiles.length).toBeGreaterThanOrEqual(20)
  })

  // Arista dura: cada route.ts que parsea body llama a un .safeParse(/.parse( de zod.
  it('ningun route.ts lee el body sin validarlo con un esquema zod', () => {
    const offenders: string[] = []
    for (const file of bodyFiles) {
      const src = readFileSync(file, 'utf8')
      if (!HAS_ZOD_PARSE.test(src)) offenders.push(rel(file))
    }
    expect(offenders.sort()).toEqual([])
  })
})

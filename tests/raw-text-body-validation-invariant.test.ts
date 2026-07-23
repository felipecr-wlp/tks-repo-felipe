/**
 * Tripwire de BODY CRUDO POR request.text() SIN VALIDAR (CWE-20 Improper Input
 * Validation), hermano y CIERRE DE PUNTO CIEGO de `body-schema-validation`.
 *
 * `body-schema-validation` exige que todo handler que lee el body con `request.json()`
 * lo valide con un esquema zod. Pero `request.json()` NO es el unico canal de entrada:
 * un handler puede leer el cuerpo crudo con `request.text()` y luego `JSON.parse(...)`
 * a mano. Ese camino ESQUIVA el tripwire hermano (que busca la cadena `request.json()`)
 * y, sin una validacion zod, reintroduce exactamente el agujero que aquel cierra: tipos
 * inesperados, campos no acotados, roles/valores que el handler nunca debio aceptar.
 *
 * El caso real vivo (S80): `time-entries/stop` lee el body opcional con
 * `request.text()` (para tolerar cuerpo vacio), hace `JSON.parse` y HOY lo valida bien
 * con un esquema zod `.strict()`. Este tripwire fija esa disciplina para que un handler
 * futuro que use el mismo canal `request.text()` no se salte la validacion en silencio.
 *
 * Contrato, una arista dura:
 *   TODO `route.ts` de la API que lee el body con `request.text()` DEBE validar con una
 *   llamada zod `.safeParse(` o `.parse(` en el mismo archivo. Un body leido por texto y
 *   usado sin pasar por un esquema cae aqui.
 *
 * Nota de alcance: `request.formData()` (subidas multipart) queda FUERA a proposito; su
 * disciplina la cubre `upload-safety` (tamano + allowlist de mime + saneo de nombre),
 * un modelo de validacion distinto al de un body JSON.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 1 route.ts lee el body por request.text() (time-entries/stop) y valida con zod.
 * Un handler nuevo que lea el body por texto sin esquema cae aqui. Nunca un silencio.
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

const PARSES_TEXT = /request\.text\(\)/
// Una validacion de esquema zod: schema.safeParse(...) o schema.parse(...).
const HAS_ZOD_PARSE = /\.(safeParse|parse)\(/

describe('Invariante: todo body leido por request.text() se valida con un esquema zod (cierra el punto ciego de body-schema-validation)', () => {
  const files = walkRoutes(API)
  const textFiles = files.filter(f => PARSES_TEXT.test(readFileSync(f, 'utf8')))

  it('el scan encuentra los route.ts que leen el body por request.text() (no esta vacio)', () => {
    expect(textFiles.length).toBeGreaterThanOrEqual(1)
  })

  // Arista dura: cada route.ts que lee el body por texto llama a un .safeParse(/.parse( de zod.
  it('ningun route.ts lee el body por request.text() sin validarlo con un esquema zod', () => {
    const offenders: string[] = []
    for (const file of textFiles) {
      const src = readFileSync(file, 'utf8')
      if (!HAS_ZOD_PARSE.test(src)) offenders.push(rel(file))
    }
    expect(offenders.sort()).toEqual([])
  })
})

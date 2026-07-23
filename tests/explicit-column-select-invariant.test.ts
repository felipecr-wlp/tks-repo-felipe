/**
 * Tripwire de SELECT SIN LISTA DE COLUMNAS (over-fetch / info disclosure por evolucion
 * de esquema, CWE-213 Exposure of Sensitive Information Due to Incompatible Policies).
 *
 * `.select('*')` (o el `.select()` pelon, que tambien trae TODO) devuelve cada columna
 * de la tabla. Hoy puede ser inocuo, pero es una FUGA LATENTE: en cuanto alguien agrega
 * una columna sensible (un flag interno, un hash, una nota privada, un token), esa
 * columna se cuela sola en la respuesta al cliente sin que nadie lo decida. La disciplina
 * del repo ya es pedir SIEMPRE columnas explicitas (`.select('id, name, ...')`), de modo
 * que exponer un campo nuevo sea una decision consciente, no un accidente por defecto.
 *
 * El caso real que motivo esto (S77): academy/certificate devolvia el certificado con
 * `.select('*')` y el join de invites hacia un `.select()` pelon. Se pasaron a listas
 * de columnas explicitas.
 *
 * Contrato, una arista dura:
 *   NINGUN `route.ts` de la API usa `.select('*')` ni `.select()` sin columnas. Todo
 *   select nombra sus columnas. Un select que trae todo cae aqui.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 0 selects sin lista en la API. Un `.select('*')` nuevo cae aqui. Nunca un silencio.
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

// `.select('*')`, `.select("*")` o `.select()` pelon: todos traen la tabla completa.
const STAR_SELECT = /\.select\(\s*(?:['"]\*['"]\s*)?\)/
// Un `*` DENTRO de un select con embed, p.ej. `.select('*, profiles(name)')`.
const STAR_INSIDE = /\.select\(\s*['"][^'"]*\*/

describe('Invariante: ningun .select de la API trae todas las columnas (anti over-fetch / CWE-213)', () => {
  const files = walkRoutes(API)

  it('el scan encuentra route.ts en la API (no esta vacio)', () => {
    expect(files.length).toBeGreaterThanOrEqual(20)
  })

  // Arista dura: ningun select sin lista de columnas (ni '*' pelon ni '*' embebido).
  it('ningun route.ts usa .select(\'*\') ni .select() sin columnas', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      src.split('\n').forEach((line, i) => {
        if (STAR_SELECT.test(line) || STAR_INSIDE.test(line)) {
          offenders.push(`${rel(file)}:${i + 1}`)
        }
      })
    }
    expect(offenders.sort()).toEqual([])
  })
})

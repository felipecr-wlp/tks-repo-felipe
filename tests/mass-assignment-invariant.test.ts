/**
 * Tripwire ESTRUCTURAL de MASS-ASSIGNMENT (over-posting).
 *
 * Complementa a patch-strict-schema.test.ts (que prueba en RUNTIME que 13 PATCH
 * concretos devuelven 422 ante una clave desconocida) con la red que ese test no
 * da: una invariante que recorre TODA la superficie mutante y caza el patron
 * peligroso ANTES de que se sume un handler nuevo.
 *
 * El hueco de mass-assignment aparece SOLO cuando un handler ESPARCE el cuerpo ya
 * parseado directo en un insert/update/upsert:
 *     .update({ ...parsed.data })      .insert(parsed.data)
 * Si el schema NO es .strict(), zod deja pasar claves extra y el spread las
 * escribe: un user podria setear columnas server-derived (workspace_id, org_id,
 * created_by, role, is_archived ajeno) que nunca debio controlar. En cambio, un
 * handler que arma el objeto de escritura CAMPO POR CAMPO
 * (.insert({ title: d.title, workspace_id: params.id, ... })) es inmune al
 * over-posting aunque el schema no sea strict: las claves extra se descartan.
 *
 * Contrato: TODO handler que esparce el cuerpo parseado en una escritura DEBE usar
 * un schema .strict() (que es lo que vuelve seguro al spread). Esparcir cuerpo sin
 * .strict() = gap de mass-assignment.
 *
 * Deteccion: se marca "spreader" al archivo mutante cuyo insert/update/upsert
 * recibe el cuerpo parseado como objeto directo (.update(parsed.data)) o lo
 * esparce dentro del objeto de escritura ({ ...parsed.data }). Nombres de cuerpo
 * parseado reconocidos: parsed.data, body, validated, input. (No se incluye el
 * alias generico "d": suele ser una fila de la DB en un .map de respuesta, no el
 * cuerpo del cliente.) A cada spreader se le exige .strict() en el archivo.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 9 handlers esparcen el cuerpo en una escritura (los PATCH endurecidos), y
 * los 9 usan .strict(); 0 gaps. Un handler nuevo que esparza el cuerpo sin
 * .strict() cae aqui. Nunca un silencio.
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

const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/g

// El cuerpo parseado pasado DIRECTO como payload de escritura.
const DIRECT_BODY_WRITE = /\.(insert|update|upsert)\(\s*(parsed\.data|body|validated|input)\b/
// El cuerpo parseado ESPARCIDO dentro del objeto de escritura.
const SPREAD_BODY_WRITE = /\.(insert|update|upsert)\(\s*\{[\s\S]{0,600}?\.\.\.(parsed\.data|body|validated|input)\b/

describe('Invariante estructural: esparcir el cuerpo en una escritura exige schema .strict()', () => {
  const gaps: string[] = []
  let totalMutating = 0
  let spreaders = 0

  for (const file of walkRoutes(API)) {
    const src = readFileSync(file, 'utf8')
    const count = src.match(MUTATING)?.length ?? 0
    if (count === 0) continue
    totalMutating += count
    const isSpreader = DIRECT_BODY_WRITE.test(src) || SPREAD_BODY_WRITE.test(src)
    if (!isSpreader) continue
    spreaders++
    if (!src.includes('.strict()')) {
      const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')
      gaps.push('/src/app/api/' + rel)
    }
  }

  it('la superficie mutante no esta vacia (el scan corre)', () => {
    expect(totalMutating).toBeGreaterThanOrEqual(100)
  })

  it('encuentra los handlers que esparcen el cuerpo en una escritura', () => {
    expect(spreaders).toBeGreaterThanOrEqual(9)
  })

  it('ningun handler esparce el cuerpo del cliente en una escritura sin .strict()', () => {
    expect(gaps.sort()).toEqual([])
  })
})

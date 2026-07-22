/**
 * Tripwire de AUTORIZACION para los subrecursos de un departamento/espacio
 * (quinto gemelo, tras task/note/project/team). Cada handler mutante bajo
 * src/app/api/spaces/[spaceId] debe autorizar al usuario sobre ESE espacio antes
 * de mutar (config del departamento, alta/baja de miembros del departamento). Las
 * rutas usan el admin client (bypassa RLS): sin el check un user autenticado
 * podria mutar un departamento (incluido uno is_restricted como RH/Legal/
 * Finanzas) de otro workspace con solo adivinar el spaceId (IDOR / BOLA).
 *
 * La autorizacion se reconoce, DENTRO del bloque del handler, por:
 *   - isWorkspaceAdminById(  compuerta solo-admin del workspace dueño del espacio.
 *                            El handler resuelve el workspace_id DEL espacio y
 *                            exige rol admin ahi; internamente hace getCachedUser
 *                            y devuelve null sin sesion (401), luego 403 si no es
 *                            admin. Es la unica autoridad que administra espacios.
 *   - space_members          lectura directa de la membresia del departamento
 *                            (roles owner|member), usada al validar altas/bajas.
 *
 * Parseo por bloques igual que auth-invariant / task / note / team authz;
 * determinista, no monta rutas ni DB.
 *
 * ALLOWLIST vacia: hoy los 4 handlers mutantes bajo spaces/[spaceId] autorizan
 * (todos solo-admin del workspace). Un subrecurso nuevo debe usar una de estas
 * primitivas o justificar aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SUBRES = join(process.cwd(), 'src', 'app', 'api', 'spaces', '[spaceId]')

/** Recorre un dir y devuelve rutas absolutas de archivos route.ts. */
function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const ALLOWLIST = new Set<string>([])

const AUTHZ = /isWorkspaceAdminById\(|space_members/

type Gap = { file: string; verb: string }

const files = walkRoutes(SUBRES)

describe('Invariante de authz: subrecurso mutante de departamento autoriza al usuario sobre el espacio', () => {
  const gaps: Gap[] = []
  for (const file of files) {
    const rel = file.replace(process.cwd(), '').replace(/\\/g, '/')
    if (ALLOWLIST.has(rel)) continue
    const src = readFileSync(file, 'utf8')

    const marks: { verb: string; start: number }[] = []
    for (const m of src.matchAll(/export async function ([A-Z]+)\b/g)) {
      marks.push({ verb: m[1], start: m.index ?? 0 })
    }
    marks.forEach((mark, i) => {
      if (!/^(POST|PATCH|PUT|DELETE)$/.test(mark.verb)) return
      const end = marks[i + 1]?.start ?? src.length
      const body = src.slice(mark.start, end)
      if (!AUTHZ.test(body)) {
        gaps.push({ file: rel, verb: mark.verb })
      }
    })
  }

  it('encuentra handlers mutantes de subrecurso (el scan no esta vacio)', () => {
    const totalMutating = files.reduce((n, f) => {
      const src = readFileSync(f, 'utf8')
      return n + (src.match(/export async function (POST|PATCH|PUT|DELETE)\b/g)?.length ?? 0)
    }, 0)
    expect(totalMutating).toBeGreaterThanOrEqual(4)
  })

  it('ningun subrecurso mutante muta sin autorizar sobre el espacio', () => {
    expect(gaps.map(g => `${g.file} :: ${g.verb}`)).toEqual([])
  })
})

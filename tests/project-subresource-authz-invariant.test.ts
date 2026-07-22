/**
 * Tripwire de AUTORIZACION para los subrecursos de un proyecto (tercer gemelo,
 * tras task-subresource y note-subresource). Toda ruta bajo
 * src/app/api/projects/[projectId] que exporte un handler mutante debe
 * autorizar al usuario sobre ESE proyecto: las rutas usan el admin client
 * (bypassa RLS), asi que sin el check un user autenticado podria mutar
 * subrecursos (custom fields, saved views, plantillas, mensajes, automatizaciones,
 * aprobacion, bulk de tareas, etc) de un proyecto de otro equipo/workspace con
 * solo adivinar el projectId (IDOR / BOLA).
 *
 * A DIFERENCIA de los gemelos de task/note (que chequean por BLOQUE de handler),
 * aqui el contrato es por ARCHIVO. Motivo: los helpers de acceso de estas rutas
 * tienen nombres heterogeneos (assertMember, getMembership, guard,
 * canAccessProject, canManageProject), asi que reconocerlos por nombre en cada
 * bloque seria fragil y dependeria de identificadores genericos. En su lugar se
 * exige que el archivo contenga una PRIMITIVA DE AUTORIZACION concreta, que es
 * justo lo que el cuerpo de esos helpers usa:
 *   - project_members      membresia directa del proyecto.
 *   - canManageProject(    helper de autoridad de proyecto (src/lib/team-access).
 *   - canAccessTeamById(   helper de acceso al equipo dueño del proyecto.
 *   - org_role             compuerta de admin de la organizacion (p. ej. la ruta
 *                          approval, accion de gobernanza solo-admin).
 * Un archivo con handler mutante SIN ninguna de estas primitivas es el smell que
 * este test caza.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * ALLOWLIST vacia: hoy los 17 archivos con handler mutante (21 handlers)
 * autorizan. Un subrecurso nuevo debe apoyarse en una de estas primitivas o
 * justificar aqui por que no aplica. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SUBRES = join(process.cwd(), 'src', 'app', 'api', 'projects', '[projectId]')

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

const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/g
const AUTHZ = /project_members|canManageProject\(|canAccessTeamById\(|org_role/

const files = walkRoutes(SUBRES)

describe('Invariante de authz: subrecurso mutante de proyecto autoriza al usuario sobre el proyecto', () => {
  const gaps: string[] = []
  let totalMutating = 0
  for (const file of files) {
    const rel = file.replace(process.cwd(), '').replace(/\\/g, '/')
    const src = readFileSync(file, 'utf8')
    const count = src.match(MUTATING)?.length ?? 0
    if (count === 0) continue
    totalMutating += count
    if (ALLOWLIST.has(rel)) continue
    if (!AUTHZ.test(src)) gaps.push(rel)
  }

  it('encuentra archivos con handler mutante (el scan no esta vacio)', () => {
    expect(totalMutating).toBeGreaterThanOrEqual(20)
  })

  it('ningun archivo con subrecurso mutante carece de primitiva de autorizacion', () => {
    expect(gaps).toEqual([])
  })
})

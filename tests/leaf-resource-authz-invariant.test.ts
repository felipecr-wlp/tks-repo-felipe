/**
 * Tripwire de AUTORIZACION para los recursos "hoja" que cuelgan directo de
 * src/app/api (no bajo tasks/notes/projects/teams/spaces/workspaces): metas,
 * sprints, pizarras y entradas de tiempo. Cada familia tiene su propio eje de
 * scoping, pero todas comparten el mismo riesgo: las rutas usan el admin client
 * (bypassa RLS), asi que sin un check en codigo un user autenticado podria mutar
 * el recurso de otra org/equipo/persona adivinando el id (IDOR / BOLA).
 *
 * Contrato por ARCHIVO y POR FAMILIA (los helpers de acceso son heterogeneos y a
 * nivel de modulo: goalAccess, goalWorkspace, authorize, loadWithAccess,
 * resolveTaskAccess; un scan por bloque no los ve). A cada familia se le exige la
 * PRIMITIVA DE AUTORIZACION concreta que su eje de scoping usa:
 *   - goals        -> workspace_members | org_role   (la meta vive en un workspace;
 *                     goalAccess/goalWorkspace exigen membresia o admin de org).
 *   - sprints      -> team_members                   (el sprint es team-scoped;
 *                     authorize/inline exigen membresia del equipo).
 *   - whiteboards  -> workspace_members | org_role   (la pizarra vive en un
 *                     workspace; loadWithAccess exige membresia, y el borrado
 *                     suma creador / admin de workspace u org).
 *   - time-entries -> resolveTaskAccess( | profile_id (anti-IDOR via membresia del
 *                     proyecto de la tarea; edicion/stop solo sobre la entrada
 *                     PROPIA, filtrada por profile_id === user.id).
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy las 4 familias (16 handlers mutantes) autorizan; 0 gaps. Un recurso nuevo
 * en una de estas familias debe apoyarse en su primitiva, o justificar aqui.
 * Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api')

/** Recorre un dir y devuelve rutas absolutas de archivos route.ts. */
function walkRoutes(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/g

const FAMILIES: { dir: string; authz: RegExp }[] = [
  { dir: 'goals', authz: /workspace_members|org_role/ },
  { dir: 'sprints', authz: /team_members/ },
  { dir: 'whiteboards', authz: /workspace_members|org_role/ },
  { dir: 'time-entries', authz: /resolveTaskAccess\(|profile_id/ },
]

describe('Invariante de authz: recurso hoja mutante (metas/sprints/pizarras/tiempo) autoriza al usuario', () => {
  const gaps: string[] = []
  let totalMutating = 0
  for (const fam of FAMILIES) {
    const files = walkRoutes(join(API, fam.dir))
    for (const file of files) {
      const rel = file.replace(process.cwd(), '').replace(/\\/g, '/')
      const src = readFileSync(file, 'utf8')
      const count = src.match(MUTATING)?.length ?? 0
      if (count === 0) continue
      totalMutating += count
      if (!fam.authz.test(src)) gaps.push(rel)
    }
  }

  it('encuentra archivos con handler mutante (el scan no esta vacio)', () => {
    expect(totalMutating).toBeGreaterThanOrEqual(16)
  })

  it('ningun recurso hoja mutante carece de su primitiva de autorizacion', () => {
    expect(gaps).toEqual([])
  })
})

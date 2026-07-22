/**
 * Tripwire de AUTORIZACION para los CREADORES DE COLECCION: los route.ts de nivel
 * raiz que exponen el POST que da de alta un recurso "contenedor"
 * (tarea, nota, proyecto, departamento, equipo, workspace). A diferencia de los
 * gemelos de subrecurso (que protegen mutaciones sobre un recurso YA existente
 * cuyo id viene en la URL), aqui el riesgo es de ALTA: sin un check el POST usa el
 * admin client (bypassa RLS) para insertar el hijo colgado de un PADRE cuyo id
 * viene en el body, asi que un user autenticado podria crear el recurso dentro del
 * proyecto/workspace/equipo/org de otro con solo adivinar el id del padre (IDOR /
 * BOLA de escritura, e inflado de datos ajenos).
 *
 * Contrato POR ARCHIVO y POR EJE DE SCOPING: a cada creador se le exige la
 * PRIMITIVA DE AUTORIZACION concreta sobre su PADRE, la misma que su cuerpo usa:
 *   - tasks       -> project_members            (la tarea cuelga de un proyecto;
 *                    exige membresia del proyecto del body).
 *   - notes       -> workspace_members          (la nota cuelga de un workspace;
 *                    exige membresia del workspace del body).
 *   - projects    -> team_members | isWorkspaceAdminById(  (el proyecto cuelga de un
 *                    equipo; exige membresia del equipo o admin del workspace).
 *   - spaces      -> workspace_members          (el departamento cuelga de un
 *                    workspace; exige membresia del workspace del body).
 *   - teams       -> isWorkspaceAdminById(      (el equipo cuelga de un workspace;
 *                    solo admin del workspace lo crea).
 *   - workspaces  -> org_members                (el workspace cuelga de la org; solo
 *                    admin de la org lo crea; padre = ORG, no otro workspace).
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los 6 creadores (6 handlers POST) autorizan sobre su padre; 0 gaps. Un
 * creador de coleccion nuevo debe apoyarse en la primitiva de su eje de scoping,
 * o justificar aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api')

const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/g

const CREATORS: { file: string; authz: RegExp }[] = [
  { file: 'tasks/route.ts',      authz: /project_members/ },
  { file: 'notes/route.ts',      authz: /workspace_members/ },
  { file: 'projects/route.ts',   authz: /team_members|isWorkspaceAdminById\(/ },
  { file: 'spaces/route.ts',     authz: /workspace_members/ },
  { file: 'teams/route.ts',      authz: /isWorkspaceAdminById\(/ },
  { file: 'workspaces/route.ts', authz: /org_members/ },
]

describe('Invariante de authz: creador de coleccion autoriza sobre el padre antes de dar de alta', () => {
  const gaps: string[] = []
  let totalMutating = 0
  for (const c of CREATORS) {
    const full = join(API, ...c.file.split('/'))
    if (!existsSync(full)) continue
    const src = readFileSync(full, 'utf8')
    const count = src.match(MUTATING)?.length ?? 0
    if (count === 0) continue
    totalMutating += count
    if (!c.authz.test(src)) gaps.push('/src/app/api/' + c.file)
  }

  it('encuentra los creadores de coleccion con handler mutante (el scan no esta vacio)', () => {
    expect(totalMutating).toBeGreaterThanOrEqual(6)
  })

  it('ningun creador de coleccion da de alta sin autorizar sobre el padre', () => {
    expect(gaps).toEqual([])
  })
})

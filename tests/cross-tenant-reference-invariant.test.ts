/**
 * Tripwire de INYECCION DE REFERENCIA CROSS-TENANT (linkear un id ajeno).
 *
 * Los tripwires de authz (S33-S44) prueban que el LLAMADOR puede tocar el recurso
 * de la URL (su membresia sobre la tarea/proyecto). Este cierra un eje distinto:
 * aunque el llamador este autorizado sobre la tarea, un handler que LINKEA un
 * segundo recurso tomado del CUERPO (un id de otra tabla) puede colar un id de OTRO
 * tenant si no valida que ese id pertenece al mismo scope. No es un IDOR sobre la
 * URL, es una fuga por la referencia del body: p.ej. asignar a la tarea una label,
 * un custom field, una dependencia o una relacion que vive en el proyecto de otro
 * workspace. El insert usa el admin client (bypassa RLS), asi que la unica defensa
 * es validar en codigo que el id del body cae en el scope derivado de la URL.
 *
 * Contrato: TODO handler que linkea a la tarea un recurso identificado por un id del
 * cuerpo DEBE validar ese id contra el scope del proyecto de la tarea (access.projectId)
 * antes de escribir. Linkear sin esa validacion = inyeccion de referencia cross-tenant.
 *
 * Registro archivo -> primitiva de validacion de scope del id del cuerpo:
 *   - tasks/[taskId]/dependencies -> .eq('project_id', access.projectId)  (la tarea
 *       de la que se depende debe vivir en el mismo proyecto)
 *   - tasks/[taskId]/relations    -> .eq('project_id', access.projectId)  (la tarea
 *       objetivo de la relacion debe vivir en el mismo proyecto)
 *   - tasks/[taskId]/labels       -> .eq('project_id', access.projectId)  (la label
 *       debe pertenecer al proyecto de la tarea)
 *   - tasks/[taskId]/assignees    -> profileInProject(  (el perfil asignado debe ser
 *       miembro del proyecto)
 *   - tasks/[taskId]/custom-fields-> field.project_id !== access.projectId  (el campo
 *       debe pertenecer al proyecto de la tarea)
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 5 handlers linkean un recurso por id del cuerpo; los 5 validan el scope; 0
 * inyecciones. Un handler nuevo que linkee un id del cuerpo a la tarea debe validar
 * ese id contra el scope y registrarse aqui con su primitiva. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api')

// Registro: archivo (ruta relativa a src/app/api) -> primitiva de validacion de
// scope del id tomado del cuerpo.
const LINKERS: Record<string, RegExp> = {
  'tasks/[taskId]/dependencies/route.ts':  /\.eq\('project_id', access\.projectId\)/,
  'tasks/[taskId]/relations/route.ts':     /\.eq\('project_id', access\.projectId\)/,
  'tasks/[taskId]/labels/route.ts':        /\.eq\('project_id', access\.projectId\)/,
  'tasks/[taskId]/assignees/route.ts':     /profileInProject\(/,
  'tasks/[taskId]/custom-fields/route.ts': /field\.project_id !== access\.projectId/,
}

describe('Invariante: todo handler que linkea un id del cuerpo lo valida contra el scope del tenant', () => {
  const gaps: string[] = []
  const missing: string[] = []

  for (const [rel, primitive] of Object.entries(LINKERS)) {
    const full = join(API, ...rel.split('/'))
    if (!existsSync(full)) {
      missing.push('/src/app/api/' + rel)
      continue
    }
    const src = readFileSync(full, 'utf8')
    if (!primitive.test(src)) gaps.push('/src/app/api/' + rel)
  }

  it('el registro de linkers no tiene entradas muertas (todos los archivos existen)', () => {
    expect(missing.sort()).toEqual([])
  })

  it('todo linker valida el id del cuerpo contra el scope del proyecto de la tarea', () => {
    expect(gaps.sort()).toEqual([])
  })
})

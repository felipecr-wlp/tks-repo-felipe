/**
 * Tripwire de AUTORIZACION para los endpoints de feature "sueltos" que no caian en
 * ninguna familia de recurso con eje de scoping propio: postulaciones a proyecto,
 * chat de equipo, propuesta al marketplace y el asistente KERN. Cierra el barrido:
 * con este archivo, TODA la superficie mutante de src/app/api queda bajo un
 * tripwire de authz (familias de scoping S33-S40, auto-alcance S41, Academia S42,
 * y estos restos S43).
 *
 * Estas rutas usan el admin client (bypassa RLS), asi que se les exige la
 * PRIMITIVA de autorizacion que su cuerpo usa:
 *   - applications/[applicationId] (PATCH decidir/retirar) -> applicant_id === user.id
 *       (retiro: solo el propio postulante) O project_members | org_role (decision:
 *       lider/manager/admin). Sin esto un tercero decidiria o retiraria una
 *       postulacion ajena (IDOR).
 *   - messages           (POST publicar en chat de equipo) -> canAccessTeamById(
 *       solo miembros del equipo (o admin del ws) publican.
 *   - marketplace/propose(POST proponer proyecto)          -> workspace_members
 *       el proponente debe pertenecer al workspace del slug.
 *
 * ALLOWLIST (minima y justificada, nunca un silencio):
 *   - kern/route.ts (POST): asistente de IA en streaming (Gemini). NO muta la DB
 *     ni opera sobre un recurso con scope: su unica compuerta correcta es
 *     autenticacion (getUser -> 401) mas rate-limit y topes de payload. No hay
 *     bypass de RLS que autorizar, por eso no lleva primitiva de scoping.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los 4 handlers mutantes sueltos estan cubiertos (3 con primitiva, 1
 * justificado). Un endpoint suelto nuevo debe apoyarse en una primitiva de authz,
 * o (si es authN-only sin recurso con scope) justificarse aqui como KERN.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api')

const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/g

// authz === null => allowlist justificado (ver cabecera).
const HANDLERS: { file: string; authz: RegExp | null }[] = [
  { file: 'applications/[applicationId]/route.ts', authz: /applicant_id === user\.id|project_members|org_role/ },
  { file: 'messages/route.ts',                     authz: /canAccessTeamById\(/ },
  { file: 'marketplace/propose/route.ts',          authz: /workspace_members/ },
  { file: 'kern/route.ts',                         authz: null },
]

describe('Invariante de authz: endpoints sueltos autorizan (o se justifican) antes de mutar', () => {
  const gaps: string[] = []
  let totalMutating = 0
  for (const h of HANDLERS) {
    const full = join(API, ...h.file.split('/'))
    if (!existsSync(full)) continue
    const src = readFileSync(full, 'utf8')
    const count = src.match(MUTATING)?.length ?? 0
    if (count === 0) continue
    totalMutating += count
    if (h.authz === null) continue // allowlist justificado
    if (!h.authz.test(src)) gaps.push('/src/app/api/' + h.file)
  }

  it('encuentra los handlers mutantes sueltos (el scan no esta vacio)', () => {
    expect(totalMutating).toBeGreaterThanOrEqual(4)
  })

  it('ningun endpoint suelto muta sin primitiva de autorizacion (salvo el allowlist justificado)', () => {
    expect(gaps).toEqual([])
  })
})

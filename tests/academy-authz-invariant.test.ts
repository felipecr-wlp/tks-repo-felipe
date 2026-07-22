/**
 * Tripwire de AUTORIZACION para la Academia (cursos, certificados, accesos). Los
 * handlers mutantes bajo src/app/api/academy usan el admin client (bypassa RLS) y
 * se reparten en DOS ejes de autorizacion distintos; a cada archivo se le exige la
 * PRIMITIVA de su eje:
 *
 *   EJE GOBERNANZA (conceder/revocar entitlement, solo admin de la org):
 *     - access/[requestId] (PATCH aprobar/rechazar) -> isOrgAdmin(
 *     - grant             (POST grant/revoke directo) -> isOrgAdmin(
 *     Sin este gate, cualquier user podria concederse (o conceder a un tercero)
 *     acceso a un curso: escalada de entitlement.
 *
 *   EJE AUTO-ALCANCE (avance/cert/solicitud propios, atados a user.id):
 *     - access      (POST solicita acceso para SI) -> profile_id: user.id
 *     - certificate (POST emite su certificado)    -> canAccessCourse(
 *     - progress    (POST guarda su avance)         -> canAccessCourse(
 *     certificate/progress ademas exigen acceso al curso (canAccessCourse) antes
 *     de escribir; sin eso un user podria forjar un cert o el avance de un curso
 *     al que no tiene acceso, o (sin el profile_id: user.id) escribir por otro.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los 5 handlers mutantes de la Academia autorizan por su eje; 0 gaps. Una
 * ruta nueva de Academia debe apoyarse en la primitiva de su eje, o justificar
 * aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api', 'academy')

const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/g

const HANDLERS: { file: string; authz: RegExp }[] = [
  { file: 'access/route.ts',              authz: /profile_id: user\.id/ },
  { file: 'access/[requestId]/route.ts',  authz: /isOrgAdmin\(/ },
  { file: 'grant/route.ts',               authz: /isOrgAdmin\(/ },
  { file: 'certificate/route.ts',         authz: /canAccessCourse\(/ },
  { file: 'progress/route.ts',            authz: /canAccessCourse\(/ },
]

describe('Invariante de authz: los handlers de la Academia autorizan por su eje (gobernanza o auto-alcance)', () => {
  const gaps: string[] = []
  let totalMutating = 0
  for (const h of HANDLERS) {
    const full = join(API, ...h.file.split('/'))
    if (!existsSync(full)) continue
    const src = readFileSync(full, 'utf8')
    const count = src.match(MUTATING)?.length ?? 0
    if (count === 0) continue
    totalMutating += count
    if (!h.authz.test(src)) gaps.push('/src/app/api/academy/' + h.file)
  }

  it('encuentra los handlers mutantes de la Academia (el scan no esta vacio)', () => {
    expect(totalMutating).toBeGreaterThanOrEqual(5)
  })

  it('ningun handler de la Academia muta sin la primitiva de su eje de autorizacion', () => {
    expect(gaps).toEqual([])
  })
})

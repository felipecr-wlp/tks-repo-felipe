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
 *   EJE AUTORIA (escribir un curso propio y moverlo por su flujo):
 *     - courses      (POST crea el borrador de quien lo pide) -> author_id: user.id
 *     - courses/[id] (PATCH mueve de estado, DELETE borra)    -> evaluarAccion(
 *     evaluarAccion es la tabla de transiciones: decide en un solo lugar quien
 *     puede hacer que y desde que estado. Un handler que decida a mano, con ifs,
 *     acabaria olvidando una regla (que el autor no aprueba su propio curso, que
 *     rechazar exige motivo) sin que nada lo delate.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * MUNDO CERRADO, NO LISTA CERRADA. Antes esta tabla solo revisaba los archivos
 * que alguien se acordo de anotar: una ruta nueva de Academia SIN NINGUN gate
 * pasaba verde, porque el scan ni la miraba. Eso es el silencio que la cabecera
 * decia prohibir. Ahora el scan DESCUBRE los route.ts del arbol y exige que cada
 * handler mutante este en la tabla; agregar una ruta sin decidir su eje de
 * autorizacion pone esto en rojo, que es justo cuando hay que pensarlo.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api', 'academy')

const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/g

const HANDLERS: { file: string; authz: RegExp }[] = [
  { file: 'access/route.ts',              authz: /profile_id: user\.id/ },
  { file: 'access/[requestId]/route.ts',  authz: /isOrgAdmin\(/ },
  { file: 'grant/route.ts',               authz: /isOrgAdmin\(/ },
  { file: 'certificate/route.ts',         authz: /canAccessCourse\(/ },
  { file: 'progress/route.ts',            authz: /canAccessCourse\(/ },
  { file: 'courses/route.ts',             authz: /author_id: user\.id/ },
  { file: 'courses/[id]/route.ts',        authz: /evaluarAccion\(/ },
  // Galeria de videos. Gobernanza: el catalogo (subir, registrar, editar,
  // borrar) es solo del admin de la org. Auto-alcance: el avance se escribe
  // SIEMPRE con profile_id: user.id; sin eso, un user marcaria videos como
  // vistos a nombre de otro.
  { file: 'videos/upload-url/route.ts', authz: /isOrgAdmin\(/ },
  { file: 'videos/route.ts',            authz: /isOrgAdmin\(/ },
  { file: 'videos/[videoId]/route.ts',  authz: /isOrgAdmin\(/ },
  { file: 'videos/[videoId]/progress/route.ts', authz: /profile_id: user\.id/ },
]

/** Todos los route.ts bajo src/app/api/academy, los anote alguien o no. */
function rutasEnElArbol(dir: string): string[] {
  const out: string[] = []
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entrada.name)
    if (entrada.isDirectory()) out.push(...rutasEnElArbol(full))
    else if (entrada.name === 'route.ts') out.push(full)
  }
  return out
}

describe('Invariante de authz: los handlers de la Academia autorizan por su eje (gobernanza, auto-alcance o autoria)', () => {
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

  // Lo que el scan mira vs. lo que existe de verdad en el disco.
  const anotados = new Set(HANDLERS.map((h) => h.file))
  const sinAnotar = rutasEnElArbol(API)
    .filter((full) => (readFileSync(full, 'utf8').match(MUTATING)?.length ?? 0) > 0)
    .map((full) => relative(API, full).split(sep).join('/'))
    .filter((rel) => !anotados.has(rel))

  it('encuentra los handlers mutantes de la Academia (el scan no esta vacio)', () => {
    expect(totalMutating).toBeGreaterThanOrEqual(7)
  })

  it('ningun handler de la Academia muta sin la primitiva de su eje de autorizacion', () => {
    expect(gaps).toEqual([])
  })

  it('ninguna ruta mutante de la Academia se queda fuera de la tabla', () => {
    expect(
      sinAnotar,
      'Estas rutas escriben y este tripwire ni las mira. Decide su eje de autorización y anótalas arriba, o serán un silencio.',
    ).toEqual([])
  })
})

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
 *   - kern/route.ts (POST) -> buildKernTools(admin, user.id)
 *       KERN parecia "solo un chat de IA", pero NO lo es: lleva herramientas
 *       agenticas que leen y ESCRIBEN con el admin client (crear tarea, editar
 *       tarea, crear nota). Su compuerta no vive en el handler sino en cada
 *       herramienta, y lo que la sostiene es que el userId se inyecta UNA vez,
 *       desde la sesion, al construir el set. Si ese segundo argumento saliera
 *       del cuerpo del request, el usuario le dictaria a la IA a nombre de quien
 *       actuar. Por eso se exige la forma exacta, no solo que se llame.
 *
 * ALLOWLIST authN-only (minima, justificada y VERIFICADA, nunca un silencio):
 *   - ai/text/route.ts (POST): reescribe un fragmento del editor de Notas
 *     (mejorar, corregir, acortar, resumir, ampliar). Entra texto, sale texto.
 *     No opera sobre un recurso con scope: su unica compuerta correcta es
 *     autenticacion (getUser -> 401) mas rate-limit y topes de payload. No hay
 *     bypass de RLS que autorizar, por eso no lleva primitiva de scoping.
 *
 *   Pero un allowlist que solo se declara es una promesa vencida esperando:
 *   basta que alguien anada una escritura para que la justificacion deje de ser
 *   cierta sin que nadie se entere. Por eso la exencion aqui es CONDICIONAL y se
 *   comprueba: mientras el archivo no toque la base (sin admin client y sin
 *   .from(), no hay recurso que autorizar y la exencion vale. El dia que escriba
 *   algo, el test cae y exige una primitiva de verdad.
 *
 *   Esa condicion no es teorica: KERN estaba en este allowlist por "ser un chat"
 *   y la comprobacion lo saco de ahi en su primera corrida. Un allowlist sin
 *   condicion verificable habria seguido afirmandolo.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los 5 handlers mutantes sueltos estan cubiertos (4 con primitiva, 1
 * authN-only con su condicion verificada). Un endpoint suelto nuevo debe
 * apoyarse en una primitiva de authz, o (si es authN-only sin recurso con
 * scope) justificarse aqui y pasar la misma prueba de que no toca la base.
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
  { file: 'kern/route.ts',                         authz: /buildKernTools\(\s*admin\s*,\s*user\.id\s*\)/ },
  { file: 'ai/text/route.ts',                      authz: null },
]

/**
 * Las herramientas agenticas de KERN. Aqui vive la autorizacion real del
 * asistente: el handler solo inyecta el userId, cada herramienta que escribe
 * tiene que comprobar el acceso a ESE recurso antes de tocarlo.
 */
const KERN_TOOLS = join(process.cwd(), 'src', 'lib', 'ai', 'kern-tools.ts')

/** Lo que delata que un archivo SI opera sobre un recurso de la base. */
const TOCA_LA_BASE = [
  { pieza: 'admin client', re: /createAdminClient\(/ },
  { pieza: 'consulta a tabla', re: /\.from\(/ },
]

describe('Invariante de authz: endpoints sueltos autorizan (o se justifican) antes de mutar', () => {
  const gaps: string[] = []
  const authNOnly: { file: string; src: string }[] = []
  let totalMutating = 0
  for (const h of HANDLERS) {
    const full = join(API, ...h.file.split('/'))
    if (!existsSync(full)) continue
    const src = readFileSync(full, 'utf8')
    const count = src.match(MUTATING)?.length ?? 0
    if (count === 0) continue
    totalMutating += count
    if (h.authz === null) {
      authNOnly.push({ file: h.file, src }) // allowlist: se verifica abajo
      continue
    }
    if (!h.authz.test(src)) gaps.push('/src/app/api/' + h.file)
  }

  it('encuentra los handlers mutantes sueltos (el scan no esta vacio)', () => {
    expect(totalMutating).toBeGreaterThanOrEqual(5)
  })

  it('ningun endpoint suelto muta sin primitiva de autorizacion (salvo el allowlist justificado)', () => {
    expect(gaps).toEqual([])
  })

  it('el allowlist authN-only sigue existiendo (no se volvio vacio en silencio)', () => {
    expect(authNOnly.map((a) => a.file).sort()).toEqual(['ai/text/route.ts'])
  })

  it('los exentos NO tocan la base: sin recurso con scope, no hay authz que exigir', () => {
    // Esta es la condicion que sostiene la exencion. El dia que uno de estos
    // archivos escriba en la base, la justificacion deja de ser cierta y este
    // test cae exigiendo una primitiva de verdad, en vez de callar.
    for (const { file, src } of authNOnly) {
      for (const { pieza, re } of TOCA_LA_BASE) {
        expect(`${file} usa ${pieza}: ${re.test(src)}`).toBe(`${file} usa ${pieza}: false`)
      }
    }
  })

  it('los exentos SI resuelven la sesion (authN es su unica compuerta, no puede faltar)', () => {
    for (const { file, src } of authNOnly) {
      expect(`${file} resuelve sesion: ${/auth\.getUser\(\)/.test(src)}`).toBe(
        `${file} resuelve sesion: true`
      )
    }
  })
})

/**
 * KERN aparte: es el unico endpoint suelto donde la autorizacion NO esta en el
 * handler. El handler solo pasa el userId de la sesion; quien tiene que
 * autorizar es cada herramienta, justo antes de escribir.
 */
describe('Invariante de authz: las herramientas agenticas de KERN autorizan antes de escribir', () => {
  const src = existsSync(KERN_TOOLS) ? readFileSync(KERN_TOOLS, 'utf8') : ''

  it('el modulo de herramientas existe (el scan no esta vacio)', () => {
    expect(src.length).toBeGreaterThan(0)
    expect(src).toMatch(/export function buildKernTools\(/)
  })

  it('el userId es un parametro del set, no algo que la IA pueda elegir', () => {
    // El modelo controla los ARGUMENTOS de cada herramienta (project_id, etc.),
    // nunca el userId: ese entra por el closure, desde la sesion. Si alguna
    // herramienta aceptara un user_id/profile_id en su schema, el prompt podria
    // pedir actuar como otra persona y la compuerta se volveria decorado.
    expect(src).toMatch(/export function buildKernTools\(\s*admin:\s*Admin,\s*userId:\s*string\s*\)/)
    const zodUserId = src.match(/(user_id|profile_id):\s*z\./g) ?? []
    expect(zodUserId).toEqual([])
  })

  it('cada herramienta que escribe comprueba el acceso al recurso', () => {
    // Se recorta el cuerpo de cada tool de escritura y se exige que ANTES del
    // insert/update aparezca una comprobacion ligada a userId.
    const ESCRITURA = /^\s{4}(create_task|update_task|create_note):\s*tool\(\{/gm
    const inicios = [...src.matchAll(ESCRITURA)]
    expect(inicios.length).toBe(3)

    const gaps: string[] = []
    const verificadas: string[] = []
    for (let i = 0; i < inicios.length; i++) {
      const nombre = inicios[i][1]
      const desde = inicios[i].index!
      const hasta = i + 1 < inicios.length ? inicios[i + 1].index! : src.length
      const cuerpo = src.slice(desde, hasta)
      const mutacion = cuerpo.search(/\.(insert|update|upsert|delete)\(/)
      if (mutacion === -1) continue
      const antes = cuerpo.slice(0, mutacion)
      // canAccessProject(admin, <id>, userId) o el filtro por workspace_members
      // con profile_id = userId. Cualquiera de las dos autoriza; ninguna es
      // opcional.
      const autoriza =
        /canAccessProject\([^)]*userId\s*\)/.test(antes) ||
        /workspace_members[\s\S]*?profile_id'?\s*,\s*userId/.test(antes)
      if (!autoriza) gaps.push(nombre)
      else verificadas.push(nombre)
    }
    // Sin esto el test pasaria en vacio: si el regex de mutacion dejara de
    // encontrar los insert/update, `gaps` quedaria vacio y el tripwire se
    // volveria verde justo cuando deja de vigilar.
    expect(verificadas.sort()).toEqual(['create_note', 'create_task', 'update_task'])
    expect(gaps.sort()).toEqual([])
  })

  it('update_task autoriza contra el proyecto de la FILA, no contra uno del argumento', () => {
    // Si autorizara contra un project_id que manda el modelo, bastaria pedirle
    // "edita la tarea <uuid ajeno> en MI proyecto" para editar la de otro.
    const cuerpo = src.slice(src.indexOf('update_task: tool({'))
    expect(cuerpo).toMatch(/canAccessProject\(\s*admin,\s*existing\.project_id,\s*userId\s*\)/)
  })

  it('el responsable que se asigna tiene que pertenecer al proyecto', () => {
    // Sin esto, KERN podria colgarle tareas a cualquiera con solo su uuid.
    expect(src).toMatch(/isAssignableToProject\(\s*admin,\s*project_id,\s*assignee_id\s*\)/)
  })
})

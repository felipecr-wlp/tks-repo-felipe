/**
 * Tripwire de autenticacion (mismo espiritu que rate-limit-invariant): TODO
 * handler mutante (POST / PATCH / PUT / DELETE) bajo src/app/api debe autenticar
 * al usuario antes de mutar. Si un handler nuevo nace sin sesion, este test lo
 * caza antes de mergear.
 *
 * La autenticacion se reconoce por una llamada a una de las primitivas de sesion
 * server-side del proyecto:
 *   - supabase.auth.getUser()   (valida el JWT en el servidor)
 *   - getCachedUser()           (wrapper cacheado de getUser)
 *   - isWorkspaceAdminById()    (helper de autoridad de workspace/space/team que
 *                                internamente hace getCachedUser y devuelve null
 *                                sin sesion; es la fuente de verdad de las rutas
 *                                de administracion, que autorizan por rol)
 *
 * ── ALCANCE: EL BLOQUE NO ES LA RUTA ────────────────────────────────────────
 * Se busca la primitiva en el ALCANCE del handler, no solo en su bloque: el
 * bloque mas los helpers del MISMO archivo que el handler llama. Cortar solo por
 * bloque cantaba hueco en rutas correctas que factorizan la compuerta, que es
 * justo lo que uno quiere que hagan:
 *
 *   async function loadAndGate(id) { ... isWorkspaceAdminById(row.workspace_id) }
 *   export async function PATCH() { const { gate } = await loadAndGate(...) ... }
 *
 * Eso no relaja nada: la primitiva sigue teniendo que existir y ser alcanzable
 * desde el handler. Deja de exigirse que este literalmente pegada. Detalle del
 * alcance y sus limites en tests/helpers/routeSource.ts.
 *
 * ── ALLOWLIST: EXENCION CONDICIONAL, NUNCA UNA PROMESA ──────────────────────
 * Dos rutas mutantes no autentican con sesion de usuario y las dos tienen razon.
 * Pero un allowlist que solo se declara es una promesa vencida esperando: basta
 * que alguien cambie el archivo para que la justificacion deje de ser cierta sin
 * que nadie se entere. Por eso cada exencion trae una CONDICION que se comprueba
 * abajo. El dia que el archivo deje de cumplirla, el test cae.
 *
 * La lista vive en tests/helpers/authExempt.ts porque la comparte el tripwire
 * hermano (mutation-auth-presence). Dos copias se separan en cuanto alguien toca
 * una, y la que quedo vieja pasa en verde sobre una razon caduca.
 *
 * Determinista: analisis lexico de las fuentes, no monta rutas ni DB.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { handlersMutantes } from './helpers/routeSource'
import { EXENCIONES_AUTH } from './helpers/authExempt'

const API = join(process.cwd(), 'src', 'app', 'api')

/** Recorre un dir y devuelve rutas absolutas de archivos route.ts. */
function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const ALLOWLIST = EXENCIONES_AUTH
const EXENTAS = new Map(ALLOWLIST.map((a) => [a.rel, a]))

const AUTH = /getUser\(|getCachedUser\(|isWorkspaceAdminById\(/

type Gap = { file: string; verb: string }

const files = walkRoutes(API)

describe('Invariante de auth: todo handler mutante autentica antes de mutar', () => {
  const gaps: Gap[] = []
  const verificados: Gap[] = []
  for (const file of files) {
    const rel = file.replace(process.cwd(), '').replace(/\\/g, '/')
    if (EXENTAS.has(rel)) continue
    const src = readFileSync(file, 'utf8')
    for (const h of handlersMutantes(src)) {
      if (AUTH.test(h.alcance)) verificados.push({ file: rel, verb: h.verb })
      else gaps.push({ file: rel, verb: h.verb })
    }
  }

  it('encuentra handlers mutantes (el scan no esta vacio)', () => {
    const totalMutating = files.reduce((n, f) => {
      const src = readFileSync(f, 'utf8')
      return n + (src.match(/export async function (POST|PATCH|PUT|DELETE)\b/g)?.length ?? 0)
    }, 0)
    expect(totalMutating).toBeGreaterThanOrEqual(100)
  })

  it('ningun handler mutante muta sin autenticar', () => {
    expect(gaps.map((g) => `${g.file} :: ${g.verb}`)).toEqual([])
  })

  it('el scan verifica de verdad (no pasa en vacio)', () => {
    // Sin esto, si el analisis de alcance dejara de encontrar handlers, `gaps`
    // quedaria vacio y el tripwire se volveria verde justo cuando deja de vigilar.
    expect(verificados.length).toBeGreaterThanOrEqual(100)
  })

  it('el allowlist sigue existiendo y apunta a archivos reales', () => {
    const relativos = files.map((f) => f.replace(process.cwd(), '').replace(/\\/g, '/'))
    for (const a of ALLOWLIST) {
      expect(`${a.rel} existe: ${relativos.includes(a.rel)}`).toBe(`${a.rel} existe: true`)
    }
    expect(ALLOWLIST.length).toBe(2)
  })

  it('cada exencion sigue cumpliendo la condicion que la justifica', () => {
    // Esta es la parte que convierte el allowlist en una afirmacion comprobada.
    // Si connectors/call dejara de hashear el token, o si la puerta cerrada de
    // workspaces empezara a tocar la base, la exencion deja de ser cierta y esto
    // cae exigiendo autenticacion de verdad, en vez de callar.
    for (const a of ALLOWLIST) {
      const src = readFileSync(join(process.cwd(), a.rel.replace(/^\//, '')), 'utf8')
      for (const { pieza, re } of a.condiciones) {
        expect(`${a.rel} ${pieza}: ${re.test(src)}`).toBe(`${a.rel} ${pieza}: true`)
      }
    }
  })
})

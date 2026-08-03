/**
 * Tripwire de AUTORIZACION de la familia CONECTORES.
 *
 * Los conectores son la puerta por la que OTRAS apps entran a WLO. Todo lo de
 * aqui se administra con el admin client (bypassa RLS) y lo que se administra
 * son las llaves mismas: keys con scopes, webhooks e instalaciones. Es decir, el
 * material con el que se abre la puerta. Sin compuerta, un usuario autenticado
 * cualquiera podria emitir una key para el workspace de otra organizacion con
 * solo adivinar su uuid, y a partir de ahi hablarle a la API como si fuera de
 * casa. La escalada no seria "leer algo que no me toca" sino "fabricarme una
 * credencial permanente".
 *
 * Por eso no basta con pertenecer al workspace: se exige ADMIN.
 *
 * ── DOS modelos de autorizacion, ninguno es una excepcion ───────────────────
 *
 * A) SESION (la mayoria): `isWorkspaceAdminById(` resuelve la sesion y el rol en
 *    el workspace, y devuelve 401 sin sesion / 403 sin admin. Ojo con el sujeto:
 *    en las rutas de coleccion el workspace viene del request, pero en las de
 *    detalle (`[installId]`, `[keyId]`, `[webhookId]`) se lee PRIMERO la fila y
 *    se autoriza contra `row.workspace_id`. Esa diferencia es justo lo que
 *    impide que alguien administre por id un recurso de otro inquilino.
 *
 * B) APP A APP (`call/[...action]`): no hay sesion que consultar, la llamada
 *    llega con `Authorization: Bearer pck_live_...`. Autoriza igual de fuerte
 *    pero por otra via: hashea el token, busca la key VIVA (`revoked_at` nulo) y
 *    toma el workspace DE LA KEY, nunca del payload, asi que no hay id que
 *    manipular. Encima cada accion exige su scope. Registrarlo como allowlist
 *    seria mentir: tiene primitiva propia y aqui se le exige.
 *
 * C) REVISION DEL CATALOGO (`apps/[appId]`): aprobar una herramienta NO es una
 *    decision de workspace, y por eso es el unico caso donde exigir admin de
 *    workspace seria AFLOJAR, no apretar. Un admin decide que se instala en SU
 *    workspace; que una herramienta entre al catalogo de todos es un nivel
 *    arriba, y lo firma el mando de la organizacion (`profiles.org_role`). La
 *    fila tampoco tiene `workspace_id` que consultar: una app del catalogo es de
 *    la organizacion, no de un inquilino. Se le exigen sus tres piezas abajo,
 *    igual que a las otras dos.
 *
 * Se recorre el arbol, no una lista de archivos: un conector nuevo aparece solo
 * y debe traer su compuerta. Nunca un silencio.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CONNECTORS = join(process.cwd(), 'src', 'app', 'api', 'connectors')

/** Recorre un dir y devuelve rutas absolutas de archivos route.ts. */
function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/g

/** Modelo A: compuerta de admin del workspace por sesion. */
const SESION = /isWorkspaceAdminById\(/

/**
 * Modelo B: app a app. Se exigen las TRES piezas, porque cada una sola se puede
 * sostener sin autorizar nada: hashear el token (no compararlo en claro), exigir
 * que la key no este revocada, y filtrar por scope de la accion.
 */
const APP_A_APP = [
  { pieza: 'hashea el token', re: /hashToken\(/ },
  { pieza: 'exige key viva (revoked_at nulo)', re: /\.is\(\s*'revoked_at'\s*,\s*null\s*\)/ },
  { pieza: 'exige el scope de la accion', re: /key\.scopes\.includes\(/ },
]

/** Rutas que autorizan con el modelo B en vez del A. */
const RUTAS_APP_A_APP = new Set<string>(['call/[...action]/route.ts'])

/**
 * Modelo C: revision del catalogo. Las tres piezas, porque cada una sola no
 * autoriza: que haya sesion, que se lea el rol de ORGANIZACION (no el del
 * workspace) y que cualquier cosa por debajo de owner/admin se corte con 403.
 */
const REVISION = [
  { pieza: 'exige sesion', re: /getCachedUser\(/ },
  { pieza: 'lee el rol de organizacion', re: /\.select\(\s*'org_role'\s*\)/ },
  { pieza: 'corta a quien no es owner ni admin', re: /!==\s*'owner'\s*&&[^\n]*!==\s*'admin'/ },
]

/** Rutas que autorizan con el modelo C. */
const RUTAS_REVISION = new Set<string>(['apps/[appId]/route.ts'])

/** Toda ruta con modelo propio queda fuera del barrido de workspace-admin. */
const MODELO_PROPIO = new Set<string>([...RUTAS_APP_A_APP, ...RUTAS_REVISION])

const archivos = walkRoutes(CONNECTORS).map((full) => ({
  rel: full.replace(CONNECTORS, '').replace(/\\/g, '/').replace(/^\//, ''),
  src: readFileSync(full, 'utf8'),
}))

const mutantes = archivos.filter((a) => (a.src.match(MUTATING)?.length ?? 0) > 0)

describe('Invariante de authz: administrar conectores exige admin del workspace', () => {
  it('encuentra archivos con handler mutante (el scan no esta vacio)', () => {
    const total = mutantes.reduce((n, a) => n + (a.src.match(MUTATING)?.length ?? 0), 0)
    expect(total).toBeGreaterThanOrEqual(7)
  })

  it('toda ruta de administracion exige admin del workspace', () => {
    const gaps = mutantes
      .filter((a) => !MODELO_PROPIO.has(a.rel))
      .filter((a) => !SESION.test(a.src))
      .map((a) => a.rel)
    expect(gaps.sort()).toEqual([])
  })

  it('las rutas de detalle autorizan contra el workspace DE LA FILA, no contra uno del request', () => {
    // Sin esto, pedir DELETE /keys/<id-ajeno> con MI workspace en el cuerpo
    // pasaria la compuerta de admin y borraria la key de otro inquilino.
    const detalle = mutantes.filter((a) => /\[\w+\]\/route\.ts$/.test(a.rel) && !MODELO_PROPIO.has(a.rel))
    expect(detalle.length).toBeGreaterThanOrEqual(3)
    const gaps = detalle
      .filter((a) => !/isWorkspaceAdminById\(\s*\w+\.workspace_id\s*\)/.test(a.src))
      .map((a) => a.rel)
    expect(gaps.sort()).toEqual([])
  })

  it('la ruta app a app autoriza por token hasheado, key viva y scope', () => {
    for (const rel of RUTAS_APP_A_APP) {
      const archivo = mutantes.find((a) => a.rel === rel)
      expect(`${rel} existe: ${Boolean(archivo)}`).toBe(`${rel} existe: true`)
      for (const { pieza, re } of APP_A_APP) {
        expect(`${rel} ${pieza}: ${re.test(archivo!.src)}`).toBe(`${rel} ${pieza}: true`)
      }
    }
  })

  it('la revision del catalogo exige mando de la organizacion, no admin de workspace', () => {
    for (const rel of RUTAS_REVISION) {
      const archivo = mutantes.find((a) => a.rel === rel)
      expect(`${rel} existe: ${Boolean(archivo)}`).toBe(`${rel} existe: true`)
      for (const { pieza, re } of REVISION) {
        expect(`${rel} ${pieza}: ${re.test(archivo!.src)}`).toBe(`${rel} ${pieza}: true`)
      }
      // Y al reves: si algun dia alguien "arregla" esta ruta poniendole la
      // compuerta de workspace, la estaria ABRIENDO, porque cualquier admin de
      // cualquier workspace podria aprobarse su propia herramienta para todos.
      expect(`${rel} no usa compuerta de workspace: ${!SESION.test(archivo!.src)}`)
        .toBe(`${rel} no usa compuerta de workspace: true`)
    }
  })

  it('la ruta app a app NO toma el workspace del payload', () => {
    // El workspace sale de la fila de la key. Si alguna vez se leyera del cuerpo,
    // el token de un workspace podria operar sobre otro.
    const archivo = mutantes.find((a) => a.rel === 'call/[...action]/route.ts')!
    expect(archivo.src).toMatch(/workspaceId = key\.workspace_id/)
  })
})

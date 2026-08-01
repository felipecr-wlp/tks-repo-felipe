/**
 * Tripwire de AUTORIZACION del CHAT de workspace.
 *
 * Cubre las dos familias del chat, que estaban sin guardian: `workspace-messages`
 * (publicar y editar mensajes) y `workspace/[workspaceId]` en SINGULAR (adjuntos
 * del chat y reacciones). Todas mutan con el admin client, asi que sin compuerta
 * en codigo cualquier usuario autenticado podria escribir en la conversacion de
 * otra organizacion, o subirle archivos, con solo adivinar el uuid del workspace.
 *
 * ── LA TRAMPA DEL SINGULAR ──────────────────────────────────────────────────
 * Existen DOS arboles casi homonimos:
 *
 *   src/app/api/workspaces/[workspaceId]/...  (plural)  -> config, miembros, roles
 *   src/app/api/workspace/[workspaceId]/...   (singular) -> chat: adjuntos, reacciones
 *
 * El tripwire de subrecursos vigila el PLURAL. El singular no lo vigilaba nadie,
 * y ese es justo el modo de fallo mas probable: una ruta nueva que aterriza en
 * la carpeta equivocada por una letra, y queda fuera del radar sin que nadie lo
 * note. Este archivo cubre el singular COMPLETO, no solo el chat, para que la
 * letra de diferencia deje de ser un escondite. Si algun dia el singular se
 * fusiona con el plural, este tripwire se queda sin archivos y el conteo minimo
 * de abajo lo grita en vez de volverse verde por vacio.
 *
 * ── LA PRIMITIVA ────────────────────────────────────────────────────────────
 * `canAccessWorkspaceById(admin, workspaceId, user.id)`: mira `workspace_members`
 * y, si no hay fila, deja pasar a owner/admin de la organizacion por `org_role`.
 * Aqui basta con PERTENECER (a diferencia de conectores, que exige admin): el
 * chat es la conversacion del equipo, no la administracion del workspace.
 *
 * Importa el ORDEN: la compuerta va antes de tocar la DB, y el `user.id` que se
 * le pasa tiene que salir de la sesion, nunca del cuerpo del request. Un
 * `profile_id` que venga del payload convierte la compuerta en decorado, porque
 * el atacante declara quien dice ser.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
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
const ACCESO = /canAccessWorkspaceById\(/

// Las dos familias del chat: el arbol singular completo y workspace-messages.
const FAMILIAS = ['workspace', 'workspace-messages']

const archivos = FAMILIAS.flatMap((fam) =>
  walkRoutes(join(API, fam)).map((full) => ({
    rel: full.replace(API, '').replace(/\\/g, '/'),
    src: readFileSync(full, 'utf8'),
  }))
)

const mutantes = archivos.filter((a) => (a.src.match(MUTATING)?.length ?? 0) > 0)

describe('Invariante de authz: el chat de workspace autoriza al usuario sobre ESE workspace', () => {
  it('encuentra archivos con handler mutante (el scan no esta vacio)', () => {
    const total = mutantes.reduce((n, a) => n + (a.src.match(MUTATING)?.length ?? 0), 0)
    expect(total).toBeGreaterThanOrEqual(3)
  })

  it('el arbol SINGULAR sigue existiendo y esta cubierto', () => {
    // Si el singular desaparece (fusion con el plural), este test cae y obliga a
    // revisar este archivo en vez de dejarlo pasando en vacio.
    const singular = mutantes.filter((a) => a.rel.startsWith('/workspace/'))
    expect(singular.length).toBeGreaterThanOrEqual(2)
  })

  it('ningun handler mutante del chat carece de la primitiva de acceso', () => {
    const gaps = mutantes.filter((a) => !ACCESO.test(a.src)).map((a) => a.rel)
    expect(gaps.sort()).toEqual([])
  })

  it('la identidad que se autoriza sale de la sesion, no del cuerpo del request', () => {
    // canAccessWorkspaceById(admin, ws, user.id). Si el tercer argumento viniera
    // del payload, el atacante elegiria a nombre de quien se le autoriza.
    const gaps = mutantes
      .filter((a) => !/canAccessWorkspaceById\([^)]*user\.id\s*\)/.test(a.src))
      .map((a) => a.rel)
    expect(gaps.sort()).toEqual([])
  })

  it('cada handler mutante resuelve la sesion antes de autorizar', () => {
    const gaps = mutantes.filter((a) => !/auth\.getUser\(\)/.test(a.src)).map((a) => a.rel)
    expect(gaps.sort()).toEqual([])
  })
})

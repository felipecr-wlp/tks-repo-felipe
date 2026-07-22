/**
 * Tripwire de autenticacion (mismo espiritu que rate-limit-invariant): TODO
 * handler mutante (POST / PATCH / PUT / DELETE) bajo src/app/api debe autenticar
 * al usuario dentro del cuerpo del handler antes de mutar. Si un handler nuevo
 * nace sin sesion, este test lo caza antes de mergear.
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
 * Se parsea el arbol de fuentes por bloques de handler (de un "export async
 * function VERBO" al siguiente), no monta rutas ni DB, asi que es determinista.
 *
 * ALLOWLIST: rutas mutantes que por diseño NO autentican con sesion de usuario
 * (webhooks/cron con su propio secreto, callbacks OAuth que ESTABLECEN la sesion).
 * Vacia por ahora: los cron endpoints gatean con CRON_SECRET pero no exportan
 * verbos mutantes bajo este patron; si alguno lo hiciera, se listaria aqui con su
 * justificacion. Mantener minima y explicita, nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

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

const ALLOWLIST = new Set<string>([])

const AUTH = /getUser\(|getCachedUser\(|isWorkspaceAdminById\(/

type Gap = { file: string; verb: string }

const files = walkRoutes(API)

describe('Invariante de auth: todo handler mutante autentica antes de mutar', () => {
  const gaps: Gap[] = []
  for (const file of files) {
    const rel = file.replace(process.cwd(), '').replace(/\\/g, '/')
    if (ALLOWLIST.has(rel)) continue
    const src = readFileSync(file, 'utf8')

    const marks: { verb: string; start: number }[] = []
    for (const m of src.matchAll(/export async function ([A-Z]+)\b/g)) {
      marks.push({ verb: m[1], start: m.index ?? 0 })
    }
    marks.forEach((mark, i) => {
      if (!/^(POST|PATCH|PUT|DELETE)$/.test(mark.verb)) return
      const end = marks[i + 1]?.start ?? src.length
      const body = src.slice(mark.start, end)
      if (!AUTH.test(body)) {
        gaps.push({ file: rel, verb: mark.verb })
      }
    })
  }

  it('encuentra handlers mutantes (el scan no esta vacio)', () => {
    const totalMutating = files.reduce((n, f) => {
      const src = readFileSync(f, 'utf8')
      return n + (src.match(/export async function (POST|PATCH|PUT|DELETE)\b/g)?.length ?? 0)
    }, 0)
    expect(totalMutating).toBeGreaterThanOrEqual(100)
  })

  it('ningun handler mutante muta sin autenticar', () => {
    expect(gaps.map(g => `${g.file} :: ${g.verb}`)).toEqual([])
  })
})

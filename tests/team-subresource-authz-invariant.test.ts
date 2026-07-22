/**
 * Tripwire de AUTORIZACION para los subrecursos de un equipo (cuarto gemelo,
 * tras task/note/project). Cada handler mutante bajo src/app/api/teams/[teamId]
 * debe autorizar al usuario sobre ESE equipo antes de mutar (recordatorios,
 * miembros, reacciones de chat, adjuntos de chat, config del equipo). Las rutas
 * usan el admin client (bypassa RLS): sin el check un user autenticado podria
 * mutar subrecursos del equipo de otro workspace con solo adivinar el teamId
 * (IDOR / BOLA).
 *
 * La autorizacion se reconoce, DENTRO del bloque del handler, por:
 *   - canAccessTeamById(     miembro del equipo O admin del workspace/org
 *                            (src/lib/team-access): rutas de acceso general
 *                            (recordatorios, reacciones, chat-files).
 *   - isWorkspaceAdminById(  compuerta solo-admin del workspace (config del
 *                            equipo, alta/baja de miembros); internamente hace
 *                            getCachedUser y devuelve null sin sesion.
 *   - team_members           lectura directa de la membresia del equipo.
 *
 * Parseo por bloques igual que auth-invariant / task / note authz; determinista.
 *
 * ALLOWLIST vacia: hoy los 8 handlers mutantes bajo teams/[teamId] autorizan.
 * Un subrecurso nuevo debe usar una de estas primitivas o justificar aqui.
 * Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SUBRES = join(process.cwd(), 'src', 'app', 'api', 'teams', '[teamId]')

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

const AUTHZ = /canAccessTeamById\(|isWorkspaceAdminById\(|team_members/

type Gap = { file: string; verb: string }

const files = walkRoutes(SUBRES)

describe('Invariante de authz: subrecurso mutante de equipo autoriza al usuario sobre el equipo', () => {
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
      if (!AUTHZ.test(body)) {
        gaps.push({ file: rel, verb: mark.verb })
      }
    })
  }

  it('encuentra handlers mutantes de subrecurso (el scan no esta vacio)', () => {
    const totalMutating = files.reduce((n, f) => {
      const src = readFileSync(f, 'utf8')
      return n + (src.match(/export async function (POST|PATCH|PUT|DELETE)\b/g)?.length ?? 0)
    }, 0)
    expect(totalMutating).toBeGreaterThanOrEqual(6)
  })

  it('ningun subrecurso mutante muta sin autorizar sobre el equipo', () => {
    expect(gaps.map(g => `${g.file} :: ${g.verb}`)).toEqual([])
  })
})

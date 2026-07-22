/**
 * Tripwire de AUTORIZACION (no solo autenticacion) para los subrecursos de una
 * tarea. auth-invariant.test.ts ya prueba que todo handler mutante autentica al
 * usuario; este va un paso mas: cada handler mutante bajo
 * src/app/api/tasks/[taskId] debe ademas VERIFICAR que ese usuario tiene acceso
 * a ESA tarea antes de mutar un subrecurso (comentarios, adjuntos, checklist,
 * watchers, etc.). Todas estas rutas usan el admin client (bypassa RLS), asi que
 * la autorizacion vive en el codigo del handler: sin este check, cualquier user
 * autenticado podria mutar subrecursos de una tarea de otro workspace con solo
 * adivinar el taskId (IDOR / BOLA).
 *
 * La autorizacion se reconoce por una llamada a una de las primitivas de acceso
 * a tarea del proyecto, presente DENTRO del bloque del handler:
 *   - checkTaskAccess(     helper canonico compartido (src/lib/task-access.ts):
 *                          resuelve project_id y exige membresia del proyecto.
 *   - loadTaskWithAccess(  helper local de attachments/route.ts (mismo check de
 *                          project_members, ademas devuelve workspace_id).
 *   - loadOwnComment(      helper local de comments/[commentId]/route.ts: exige
 *                          que el user sea el AUTOR (author_id), check mas
 *                          estricto que membresia.
 *   - project_members      check de membresia inline (comments POST).
 *
 * Se parsea por bloques de handler (de un "export async function VERBO" al
 * siguiente), igual que auth-invariant / rate-limit-invariant; determinista, no
 * monta rutas ni DB.
 *
 * ALLOWLIST vacia: hoy los 22 handlers mutantes bajo tasks/[taskId] autorizan.
 * Si nace un subrecurso nuevo que autoriza con OTRA primitiva, se agrega su
 * marcador a AUTHZ (o, si por diseño no aplica, se justifica aqui). Nunca un
 * silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SUBRES = join(process.cwd(), 'src', 'app', 'api', 'tasks', '[taskId]')

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

const AUTHZ = /checkTaskAccess\(|loadTaskWithAccess\(|loadOwnComment\(|project_members/

type Gap = { file: string; verb: string }

const files = walkRoutes(SUBRES)

describe('Invariante de authz: subrecurso mutante de tarea autoriza al usuario sobre la tarea', () => {
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
    expect(totalMutating).toBeGreaterThanOrEqual(20)
  })

  it('ningun subrecurso mutante muta sin autorizar sobre la tarea', () => {
    expect(gaps.map(g => `${g.file} :: ${g.verb}`)).toEqual([])
  })
})

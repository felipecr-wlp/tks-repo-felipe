/**
 * Tripwire de AUTORIZACION para los subrecursos de una nota (gemelo de
 * task-subresource-authz-invariant, aplicado a notas). Cada handler mutante bajo
 * src/app/api/notes/[noteId] debe verificar que el usuario tiene acceso a ESA
 * nota antes de mutar un subrecurso (comentarios, acuses, aprobacion,
 * asignaciones, menciones, versiones, etc).
 *
 * Todas las rutas de notas usan el admin client (bypassa RLS), asi que la policy
 * RESTRICTIVE notes_restrict_space (departamentos is_restricted como RH/Legal/
 * Finanzas) NO aplica ahi: la autorizacion vive en el codigo del handler. Sin el
 * check, un user autenticado podria leer o mutar subrecursos de una nota de un
 * espacio restringido de otro departamento con solo adivinar el noteId
 * (IDOR / BOLA).
 *
 * La autorizacion se reconoce por, dentro del bloque del handler:
 *   - canAccessNoteSpace(  helper canonico (src/lib/note-space-access.ts) que
 *                          replica la RLS del espacio restringido en la API.
 *   - loadNote...(         cualquier loader local de la ruta (loadNote,
 *                          loadNoteWithAccess, loadNoteForComments,
 *                          loadNoteForMentions) que carga la nota y adentro
 *                          exige membresia del workspace + canAccessNoteSpace.
 *
 * Parseo por bloques de handler igual que auth-invariant / task-subresource-
 * authz; determinista, no monta rutas ni DB.
 *
 * ALLOWLIST vacia: hoy los 12 handlers mutantes bajo notes/[noteId] autorizan.
 * Un subrecurso nuevo debe usar canAccessNoteSpace (directo o via un loader
 * loadNote*), o justificar aqui por que no aplica. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SUBRES = join(process.cwd(), 'src', 'app', 'api', 'notes', '[noteId]')

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

const AUTHZ = /canAccessNoteSpace\(|loadNote/

type Gap = { file: string; verb: string }

const files = walkRoutes(SUBRES)

describe('Invariante de authz: subrecurso mutante de nota autoriza al usuario sobre la nota', () => {
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
    expect(totalMutating).toBeGreaterThanOrEqual(10)
  })

  it('ningun subrecurso mutante muta sin autorizar sobre la nota', () => {
    expect(gaps.map(g => `${g.file} :: ${g.verb}`)).toEqual([])
  })
})

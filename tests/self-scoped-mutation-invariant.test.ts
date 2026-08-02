/**
 * Tripwire de AUTORIZACION para las mutaciones AUTO-ALCANCE (self-scoped): rutas
 * donde el user solo puede tocar SU PROPIA fila (su perfil, sus notificaciones,
 * su onboarding, unirse EL MISMO por un invite). El eje de scoping NO es un
 * workspace/proyecto/equipo, es la IDENTIDAD del que llama.
 *
 * A DIFERENCIA de los gemelos de scoping (que exigen membresia sobre un padre),
 * aqui el riesgo es de SUPLANTACION: estas rutas usan el admin client (bypassa
 * RLS) y el id de la fila objetivo podria venir del cliente (params.id del URL o
 * el body). Sin atar la escritura a user.id, un user autenticado podria marcar
 * como leida / borrar la notificacion de otro, editar el perfil ajeno, o meter a
 * un tercero a un workspace adivinando su id. La defensa es SIEMPRE filtrar la
 * mutacion por la identidad del token (user.id), nunca por un id que el cliente
 * controla.
 *
 * Contrato POR ARCHIVO y POR HANDLER: cada verbo mutante debe, en su bloque, atar
 * la escritura a la identidad del que llama con su PRIMITIVA concreta:
 *   - profile              -> .eq('id', user.id)          (edita solo su perfil).
 *   - onboarding           -> .eq('id', user.id)          (crea org/ws y se ata a
 *                             si mismo como owner; 409 si ya tiene org).
 *   - notifications/mark-all-read -> recipient_id == user.id  (solo las suyas).
 *   - notifications/[id]   -> recipient_id == user.id      (PATCH y DELETE: el id
 *                             del URL se cruza con el destinatario; fila ajena =
 *                             0 filas, sin efecto).
 *   - invites/[code]/join  -> profile_id: user.id          (se une EL MISMO; el rol
 *                             sale del invite, no del body: sin escalada).
 *   - daily-reports        -> ensureReport(..., user.id, ...)  (el reporte del dia se
 *                             resuelve por la identidad del token; el body NUNCA trae
 *                             profile_id, asi que no hay forma de firmar el dia de
 *                             otra persona, ni siquiera siendo admin).
 *   - daily-reports/entries/[entryId] -> profile_id !== user.id (se sube por report_id
 *                             hasta el dueño: el id de una entrada es adivinable, la
 *                             pertenencia no).
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los 9 handlers mutantes auto-alcance atan la escritura a user.id; 0 gaps.
 * Una ruta self-scoped nueva debe atar su mutacion a la identidad del token, o
 * justificar aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api')

const SELF_SCOPED: { file: string; identity: RegExp }[] = [
  { file: 'profile/route.ts',                     identity: /\.eq\('id', user\.id\)/ },
  { file: 'onboarding/route.ts',                  identity: /\.eq\('id', user\.id\)/ },
  { file: 'notifications/mark-all-read/route.ts', identity: /recipient_id', user\.id/ },
  { file: 'notifications/[id]/route.ts',          identity: /recipient_id', user\.id/ },
  { file: 'invites/[code]/join/route.ts',         identity: /profile_id: user\.id/ },
  // El nombre del helper se escribe como FAMILIA (`ensure...Report`) a proposito.
  // Antes decia `ensureReport(` literal; el dia que la funcion se renombro a
  // `ensureDailyReport` el tripwire se puso rojo sin que nada se hubiera roto, y un
  // rojo que no significa nada es exactamente lo que hace que un rojo de verdad
  // pase desapercibido. Lo que importa no es como se llama la funcion, es que la
  // identidad que resuelve la fila sea la del token y ocupe ESA posicion.
  { file: 'daily-reports/route.ts',               identity: /ensure\w*Report\(\s*admin,\s*\w+,\s*user\.id\b/ },
  { file: 'daily-reports/entries/[entryId]/route.ts', identity: /profile_id !== user\.id/ },
]

type Gap = { file: string; verb: string }

describe('Invariante de authz: mutacion auto-alcance ata la escritura a la identidad del que llama', () => {
  const gaps: Gap[] = []
  let totalMutating = 0

  const desaparecidas: string[] = []

  for (const entry of SELF_SCOPED) {
    const full = join(API, ...entry.file.split('/'))
    if (!existsSync(full)) { desaparecidas.push(entry.file); continue }
    const rel = '/src/app/api/' + entry.file
    const src = readFileSync(full, 'utf8')

    const marks: { verb: string; start: number }[] = []
    for (const m of src.matchAll(/export async function ([A-Z]+)\b/g)) {
      marks.push({ verb: m[1], start: m.index ?? 0 })
    }
    marks.forEach((mark, i) => {
      if (!/^(POST|PATCH|PUT|DELETE)$/.test(mark.verb)) return
      totalMutating++
      const end = marks[i + 1]?.start ?? src.length
      const body = src.slice(mark.start, end)
      if (!entry.identity.test(body)) {
        gaps.push({ file: rel, verb: mark.verb })
      }
    })
  }

  it('encuentra los handlers mutantes auto-alcance (el scan no esta vacio)', () => {
    expect(totalMutating).toBeGreaterThanOrEqual(9)
  })

  it('ninguna ruta vigilada desaparecio del registro sin avisar', () => {
    // El `continue` de arriba saltaba en silencio las rutas que ya no existen: una
    // ruta movida de sitio dejaba de estar vigilada y el tripwire seguia verde.
    // Si se movio, se actualiza el registro; si se borro, se saca de la lista.
    expect(desaparecidas).toEqual([])
  })

  it('ningun handler auto-alcance muta sin atar la escritura a user.id', () => {
    expect(gaps.map(g => `${g.file} :: ${g.verb}`)).toEqual([])
  })
})

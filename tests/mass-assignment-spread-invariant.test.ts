/**
 * Tripwire de MASS ASSIGNMENT POR SPREAD DE INPUT EN UN WRITE (OWASP A08 Software
 * and Data Integrity Failures / A01 Broken Access Control via over-posting).
 *
 * El patron comodo y peligroso: tomar el cuerpo ya validado y VOLCARLO ENTERO en un
 * write, `db.from(T).update({ ...parsed.data })`. Es limpio de leer, pero convierte
 * al schema de zod en la UNICA reja entre el cliente y las columnas de la tabla: lo
 * que el schema deje pasar, el cliente lo ESCRIBE. Dos fugas nacen de ahi:
 *   - PASSTHROUGH: `z.object({...}).passthrough()` conserva las claves DESCONOCIDAS,
 *     asi que el cliente cuela cualquier columna (`is_admin`, `org_id`, `owner_id`)
 *     y la pisa. Es over-posting de manual.
 *   - COLUMNA DE AUTORIDAD DECLARADA: aunque el schema haga strip (default de zod),
 *     si DECLARA una columna de autoridad/tenant/identidad (`workspace_id`, `org_id`,
 *     `role`, `id`, `created_by`...) y luego hace spread en un UPDATE, el cliente
 *     mueve la fila de tenant, se reasigna el rol o se firma como otro. El spread la
 *     lleva a la tabla sin control.
 * La defensa: en un handler que hace spread de input a un write, el schema (a) NUNCA
 * usa `.passthrough()` y (b) SOLO declara columnas editables de contenido (nombre,
 * descripcion, status, fechas), jamas una columna de autoridad. La autoridad y el
 * tenant se fijan en el server desde la sesion o los params de ruta, en un objeto
 * EXPLICITO, no por spread del cuerpo.
 *
 * Contrato, tres aristas:
 *   A) BAN GLOBAL DE PASSTHROUGH: ningun route.ts usa `.passthrough(`. Un schema que
 *      conserva claves desconocidas es over-posting listo para spread.
 *   B) DISCIPLINA DEL SPREAD-WRITER: todo route.ts que hace spread de input
 *      (`...parsed.data` / `...body` / `...payload` / `...input`) en un write
 *      (insert|update|upsert) NO declara una columna de autoridad como campo de zod
 *      (`id|created_by|author_id|uploaded_by|added_by|granted_by|workspace_id|org_id|
 *      role|uses_count|password_hash|refresh_token|access_token`). Los `*_id`
 *      editables de contenido (owner_id, space_id, parent_note_id, assignee_id...) NO
 *      son autoridad: el `\b` antepuesto los excluye a proposito.
 *   C) ANTI-REGRESION: el conjunto de spread-writers es EXACTAMENTE el registro
 *      auditado. Un handler nuevo que vuelque input crudo en un write rompe el test y
 *      fuerza revisar su schema antes de confiar en el spread.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 13 spread-writers, 0 passthrough, 0 columna de autoridad en un spread. Un
 * schema que afloje a passthrough, o un spread-writer que declare autoridad, cae
 * aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const API = join(SRC, 'app', 'api')

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const rel = (file: string) => file.replace(SRC, '').replace(/\\/g, '/')

// Un SPREAD-WRITER: vuelca input ya parseado y ademas hace un write a la DB.
const SPREADS_INPUT = /\.\.\.(?:parsed\.data|body|payload|input)\b/
const WRITES_DB = /\.(?:insert|update|upsert)\s*\(/
// Passthrough: conserva claves desconocidas (over-posting).
const PASSTHROUGH = /\.passthrough\(/
// Una columna de AUTORIDAD declarada como campo de zod. El \b evita cazar los *_id
// de contenido (owner_id, space_id, project_id, parent_note_id, assignee_id...).
const AUTHORITY_FIELD =
  /\b(?:id|created_by|author_id|uploaded_by|added_by|granted_by|workspace_id|org_id|role|uses_count|password_hash|refresh_token|access_token)\s*:\s*z\./

// Registro auditado de handlers que hacen spread de input en un write. Todos son
// rutas [id] de PATCH/DELETE cuyo schema declara solo columnas de contenido; el
// tenant/autoridad se fija en el server desde params o sesion, no por spread.
const REGISTRY = [
  '/app/api/goals/[goalId]/route.ts',
  '/app/api/notes/[noteId]/route.ts',
  '/app/api/projects/[projectId]/automations/[automationId]/route.ts',
  '/app/api/projects/[projectId]/charter/route.ts',
  '/app/api/projects/[projectId]/route.ts',
  '/app/api/spaces/[spaceId]/route.ts',
  '/app/api/sprints/[sprintId]/route.ts',
  '/app/api/tasks/[taskId]/checklist-items/[itemId]/route.ts',
  '/app/api/tasks/[taskId]/route.ts',
  '/app/api/teams/[teamId]/route.ts',
  '/app/api/time-entries/[entryId]/route.ts',
  '/app/api/whiteboards/[whiteboardId]/route.ts',
  '/app/api/workspaces/[workspaceId]/route.ts',
]

describe('Invariante: un spread de input en un write no acarrea columnas de autoridad', () => {
  const files = walkRoutes(API)
  const spreadWriters: string[] = []

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    if (SPREADS_INPUT.test(src) && WRITES_DB.test(src)) spreadWriters.push(rel(file))
  }

  it('el scan encuentra los spread-writers (no esta vacio)', () => {
    expect(spreadWriters.length).toBeGreaterThanOrEqual(10)
  })

  // Arista A: nadie afloja un schema a passthrough (over-posting listo para spread).
  it('ningun route.ts usa .passthrough() (over-posting)', () => {
    const offenders: string[] = []
    for (const file of files) {
      if (PASSTHROUGH.test(readFileSync(file, 'utf8'))) offenders.push(rel(file))
    }
    expect(offenders.sort()).toEqual([])
  })

  // Arista B: ningun spread-writer declara una columna de autoridad como campo de zod.
  it('ningun spread-writer declara una columna de autoridad en su schema', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (!(SPREADS_INPUT.test(src) && WRITES_DB.test(src))) continue
      if (AUTHORITY_FIELD.test(src)) offenders.push(rel(file))
    }
    expect(offenders.sort()).toEqual([])
  })

  // Arista C: anti-regresion. El conjunto de spread-writers es el registro.
  it('el conjunto de spread-writers es exactamente el registro auditado', () => {
    expect(spreadWriters.sort()).toEqual([...REGISTRY].sort())
  })
})

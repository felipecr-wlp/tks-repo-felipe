/**
 * Tripwire de IDOR DE LECTURA (Broken Object Level Authorization en el GET).
 *
 * S55 cerro el lado de ESCRITURA: toda mutacion gatea la identidad. Este cierra el
 * gemelo de LECTURA. Un handler GET que consulta con el admin client (service_role,
 * que BYPASSA RLS) devuelve CUALQUIER fila que pida, sin importar de que tenant sea.
 * Si ese GET no gatea al llamador, un anonimo (o un usuario de otro equipo) lee
 * datos ajenos con solo pegarle a la URL: IDOR / exposicion de datos. El GET seguro
 * hace una de dos cosas: consulta con el user client (createClient, sujeto a RLS,
 * seguro por construccion) o, si usa el admin client, PRIMERO gatea la identidad
 * (lee la sesion o pasa por un gate de rol) y acota la query al scope del usuario.
 *
 * Contrato: en TODO route.ts, si el CUERPO del handler GET instancia el admin
 * client (createAdminClient), ese mismo cuerpo debe referenciar una primitiva de
 * gate de identidad (getCachedUser / getUser / requireUser / isWorkspaceAdminById,
 * o, para un cron sin sesion, CRON_SECRET). Un GET que lea con la llave maestra sin
 * gatear cae aqui.
 *
 * Deteccion estructural: se trocea cada archivo por bloque de handler (de un
 * "export async function VERBO" al siguiente), se aisla el bloque GET y se analiza
 * SOLO ese bloque, para no dejar que un gate del POST tape un GET abierto.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy todo GET que toca el admin client tambien gatea la identidad; 0 IDOR de
 * lectura. Un GET nuevo que lea con service_role sin gate cae aqui. Nunca un
 * silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api')

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const USES_ADMIN = /createAdminClient\(/
const AUTH_GATE = /getCachedUser\(|getUser\(|requireUser\(|isWorkspaceAdminById\(|process\.env\.CRON_SECRET/

describe('Invariante: todo GET que lee con el admin client gatea la identidad', () => {
  const files = walkRoutes(API)
  const adminGets: string[] = []
  const gaps: string[] = []

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')

    // Marcas de cada "export async function VERBO" para trocear por handler.
    const marks: { verb: string; start: number }[] = []
    for (const m of src.matchAll(/export async function ([A-Z]+)\b/g)) {
      marks.push({ verb: m[1], start: m.index ?? 0 })
    }
    marks.forEach((mark, i) => {
      if (mark.verb !== 'GET') return
      const end = marks[i + 1]?.start ?? src.length
      const body = src.slice(mark.start, end)
      if (!USES_ADMIN.test(body)) return // GET con user client (RLS): seguro por construccion.
      adminGets.push(rel)
      if (!AUTH_GATE.test(body)) gaps.push('/src/app/api/' + rel)
    })
  }

  it('el scan encuentra GETs que usan el admin client (no esta vacio)', () => {
    expect(adminGets.length).toBeGreaterThanOrEqual(10)
  })

  it('todo GET con admin client referencia un gate de identidad en su propio cuerpo', () => {
    expect(gaps.sort()).toEqual([])
  })
})

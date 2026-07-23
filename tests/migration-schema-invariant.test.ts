/**
 * Tripwires de migraciones SQL (mismo espiritu que rate-limit-invariant y
 * xss-invariant): defienden dos bombas de confiabilidad ya sufridas.
 *
 * (a) SCHEMA DUPLICADO. Debe existir EXACTAMENTE UN archivo *initial_schema*.sql.
 *     Hubo un archivo muerto 0001_initial_schema.sql con un schema DIVERGENTE
 *     (organizations/organization_id/auth_org_id vs el canonico
 *     org_members/org_id) que, al ordenar ANTES del canonico 20260421, corrompia
 *     un `db reset` en limpio. Ademas: ninguna migracion fuera del initial_schema
 *     puede usar `CREATE TABLE ` sin `IF NOT EXISTS` (idempotencia; el catchup y
 *     los re-runs dependen de ello).
 *
 * (b) RECURSION RLS (Postgres 42P17). Ninguna `CREATE POLICY` sobre la tabla T
 *     puede tener un cuerpo USING/WITH CHECK que haga `FROM T` (su propia tabla)
 *     sin delegar en un helper SECURITY DEFINER. Ese patron dispara "infinite
 *     recursion detected in policy for relation T". Los helpers conocidos
 *     (user_workspace_ids, user_admin_workspace_ids, auth_org_id, is_*) rompen el
 *     ciclo y estan en la allowlist.
 *
 *     Solo cuenta la ULTIMA definicion de cada policy (por nombre) en orden de
 *     migracion: un DROP+CREATE posterior reemplaza a la original, asi que la
 *     definicion viva es la que importa (ej. workspace_members_select lo arreglo
 *     20260719020000; insert/delete los arregla 20260722120000).
 *
 * Se leen los .sql como texto; no montan DB. Deterministas y baratos.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/** Quita comentarios de linea (-- ...) para no matchear SQL comentado. */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--')
      return i === -1 ? line : line.slice(0, i)
    })
    .join('\n')
}

describe('Invariante migraciones: un solo initial_schema y CREATE TABLE idempotente', () => {
  const files = migrationFiles()

  it('el scan no esta vacio (defensa contra falso verde)', () => {
    expect(files.length).toBeGreaterThanOrEqual(10)
  })

  it('existe exactamente UN archivo *initial_schema*.sql', () => {
    const initials = files.filter((f) => /initial_schema/i.test(f))
    expect(initials).toHaveLength(1)
  })

  it('ninguna migracion fuera del initial_schema usa CREATE TABLE sin IF NOT EXISTS', () => {
    const offenders: string[] = []
    for (const f of files) {
      if (/initial_schema/i.test(f)) continue
      const sql = stripLineComments(readFileSync(join(MIGRATIONS, f), 'utf8'))
      // CREATE TABLE [temp/unlogged...] <nombre> sin el IF NOT EXISTS inmediato.
      const re = /\bCREATE\s+(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|UNLOGGED)\s+)?TABLE\s+(?!IF\s+NOT\s+EXISTS\b)/gi
      if (re.test(sql)) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })
})

describe('Invariante RLS: ninguna policy se auto-referencia sin helper SECURITY DEFINER', () => {
  const files = migrationFiles()

  // Funciones que rompen el ciclo (SECURITY DEFINER) o que no leen la tabla via
  // RLS. Si una policy sobre T referencia FROM T pero SOLO dentro de una llamada
  // a uno de estos helpers, no hay recursion.
  const HELPERS = [
    'user_workspace_ids',
    'user_admin_workspace_ids',
    'auth_org_id',
    'is_org_admin',
    'is_workspace_member',
    'is_project_member',
    'is_space_member',
    'is_space_admin',
  ]

  // KNOWN-RISK allowlist: policies self-referenciales PREEXISTENTES en el schema
  // canonico (20260421000000) que aun NO tienen fix. Son la MISMA clase de bomba
  // 42P17 que workspace_members, pero sobre team_members / project_members, y su
  // arreglo (helpers SECURITY DEFINER user_team_ids/user_project_ids) esta fuera
  // del alcance de este cambio. Se listan EXPLICITAMENTE para que el riesgo sea
  // visible y auditable, nunca un silencio. Al arreglarlas, borrar su entrada
  // aqui y el test las volvera a proteger.
  const KNOWN_RISK = new Set<string>([
    'team_members_insert',
    'team_members_delete',
    'project_members_select',
    'project_members_insert',
    'project_members_delete',
  ])

  /**
   * Extrae los bloques CREATE POLICY ... hasta el ';' de cierre a nivel superior.
   * Devuelve { name, table, body } por cada policy.
   */
  function extractPolicies(sql: string): { name: string; table: string; body: string }[] {
    const out: { name: string; table: string; body: string }[] = []
    const re = /CREATE\s+POLICY\s+(?:"([^"]+)"|(\S+))\s+ON\s+(?:public\.)?"?(\w+)"?/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(sql)) !== null) {
      const name = m[1] ?? m[2]
      const table = m[3]
      // Cuerpo = desde el match hasta el proximo ';' balanceando parentesis.
      let i = re.lastIndex
      let depth = 0
      let end = sql.length
      for (; i < sql.length; i++) {
        const c = sql[i]
        if (c === '(') depth++
        else if (c === ')') depth--
        else if (c === ';' && depth <= 0) {
          end = i
          break
        }
      }
      out.push({ name, table, body: sql.slice(re.lastIndex, end) })
    }
    return out
  }

  // Ultima definicion viva de cada policy por nombre (orden de migracion).
  const finalDefs = new Map<string, { file: string; table: string; body: string }>()
  for (const f of files) {
    const sql = stripLineComments(readFileSync(join(MIGRATIONS, f), 'utf8'))
    for (const { name, table, body } of extractPolicies(sql)) {
      finalDefs.set(name, { file: f, table, body })
    }
  }

  it('el scan encuentra policies (defensa contra falso verde)', () => {
    expect(finalDefs.size).toBeGreaterThanOrEqual(30)
  })

  it('ninguna policy viva hace FROM <su propia tabla> fuera de un helper SECURITY DEFINER', () => {
    const offenders: string[] = []
    for (const [name, { file, table, body }] of finalDefs) {
      if (KNOWN_RISK.has(name)) continue
      // Neutraliza las llamadas a helpers permitidos para no contar el FROM T
      // que ocurriria dentro de su invocacion.
      let scrub = body
      for (const h of HELPERS) {
        scrub = scrub.replace(new RegExp(`\\b${h}\\s*\\([^)]*\\)`, 'gi'), ' ')
      }
      const selfRef = new RegExp(`\\bFROM\\s+(?:public\\.)?"?${table}"?\\b`, 'i')
      if (selfRef.test(scrub)) {
        offenders.push(`${file} :: policy "${name}" ON ${table}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('la workspace_members insert/delete/select vivas NO se auto-referencian (fix aplicado)', () => {
    for (const name of [
      'workspace_members_select',
      'workspace_members_insert',
      'workspace_members_delete',
    ]) {
      const def = finalDefs.get(name)
      expect(def, `falta definicion de ${name}`).toBeTruthy()
      let scrub = def!.body
      for (const h of HELPERS) {
        scrub = scrub.replace(new RegExp(`\\b${h}\\s*\\([^)]*\\)`, 'gi'), ' ')
      }
      expect(
        /\bFROM\s+(?:public\.)?"?workspace_members"?\b/i.test(scrub),
        `${name} aun se auto-referencia`
      ).toBe(false)
    }
  })
})

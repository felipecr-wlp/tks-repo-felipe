/**
 * Tripwire de AUTORIZACION del LADO LECTURA (read-side IDOR / BOLA de lectura).
 *
 * Los tripwires S33-S44 cierran la superficie MUTANTE (POST/PATCH/PUT/DELETE).
 * Pero un GET tambien puede filtrar datos ajenos: si un handler de LECTURA usa el
 * admin client (bypassa RLS) y su recurso se identifica por un id de la URL
 * (segmento dinamico [x]), un user autenticado podria LEER el recurso de otro
 * tenant con solo adivinar/enumerar el id. No muta nada, pero es fuga de datos
 * cross-tenant igual de grave (IDOR de lectura).
 *
 * Este archivo cierra ese hueco de forma estructural, analogo al capstone: enumera
 * TODO route.ts bajo src/app/api que (a) tenga un segmento dinamico [x] en su ruta,
 * (b) use createAdminClient y (c) exponga un GET, y exige que el ARCHIVO contenga
 * una PRIMITIVA DE ACCESO. El gate suele vivir en un helper (de modulo o importado,
 * p.ej. checkTaskAccess), por eso se escanea el archivo completo, no solo el bloque
 * GET. La primitiva es una de: lectura de tabla de membresia (project_members,
 * workspace_members, team_members, space_members, org_members), gate de rol
 * (org_role, isAdmin(, isOrgAdmin(, isWorkspaceAdmin), helper de acceso reconocido
 * (checkTaskAccess, canAccessCourse, canAccessTeamById) o atado de identidad
 * (recipient_id, applicant_id). Un GET+admin sobre id dinamico SIN ninguna = gap.
 *
 * ALLOWLIST (minima y justificada, nunca un silencio):
 *   - invites/[code] (GET): preview publico del invite (nombre del workspace, rol,
 *     si pide password). Requiere estar autenticado pero NO membresia: el CODIGO
 *     del invite (16 chars no adivinables de generateInviteCode) ES la capacidad,
 *     y la respuesta NUNCA expone password_hash. No hay recurso con scope de tenant
 *     que proteger por membresia, por eso no lleva primitiva de membresia.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 43 rutas GET+admin sobre id dinamico: 42 con primitiva de acceso, 1
 * allowlisted (invites/[code]). Una ruta de lectura nueva con admin client sobre id
 * dinamico debe apoyarse en una primitiva de acceso, o (si es un preview publico
 * por capacidad no adivinable) justificarse aqui. Nunca un silencio.
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

// Primitiva de acceso: membresia, rol, helper de acceso reconocido o atado de
// identidad. NO incluye "user.id" a secas: eso solo prueba el 401 de authN, no que
// la lectura este acotada a la membresia del que llama.
//
// Helpers y gates de rol: nombrarlos YA es el gate, porque su unico proposito es
// resolver el acceso. `loadItemAccess` (content) y `resolveFlowAccess` (flows)
// devuelven el nivel de acceso del que llama, del mismo tipo que canAccessTeamById.
const ACCESS_HELPER =
  /org_role|isAdmin\(|isOrgAdmin\(|isWorkspaceAdmin|checkTaskAccess|canAccessCourse|canAccessTeamById|loadItemAccess\(|resolveFlowAccess\(|recipient_id|applicant_id/

// Tablas de membresia. Nombrarlas NO basta, y esa fue la leccion cara: la ruta
// /api/flows/[flowId]/members leia `workspace_members` como CARGA UTIL ("dame el
// equipo entero de este workspace"), no como filtro, y el tripwire la daba por
// buena. Debajo de ese falso negativo habia un IDOR real: cualquier persona
// autenticada con un uuid de flujo se llevaba el directorio con correos de otro
// inquilino. Una tabla de membresia solo cuenta como gate si la consulta esta
// ACOTADA A QUIEN LLAMA.
const MEMBERSHIP_TABLE = /project_members|workspace_members|team_members|space_members|org_members/
// Atado a quien llama: la identidad de la sesion entra como ULTIMO ARGUMENTO de
// una llamada, que es la forma que toman los dos gates reales del repo:
//   .eq('profile_id', user.id)              filtro directo
//   assertMember(admin, projectId, user.id) helper de modulo o importado
// Lo que NO cuenta es que `user` solo aparezca en el `if (!user)` del 401: ese era
// exactamente el estado de la ruta de miembros de flujos. Sesion sin autorizacion.
const CALLER_BOUND = /,\s*user\.id\s*\)/

function tieneprimitivaDeAcceso(src: string): boolean {
  if (ACCESS_HELPER.test(src)) return true
  return MEMBERSHIP_TABLE.test(src) && CALLER_BOUND.test(src)
}

// Rutas justificadas como preview publico por capacidad no adivinable (ver cabecera).
const ALLOWLIST = new Set<string>([
  'invites/[code]',
])

describe('Invariante de authz (lectura): ningun GET+admin sobre id dinamico lee sin primitiva de acceso', () => {
  const gaps: string[] = []
  let total = 0

  for (const file of walkRoutes(API)) {
    const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '').replace(/\/route\.ts$/, '')
    if (!rel.includes('[')) continue // solo rutas con segmento dinamico
    const src = readFileSync(file, 'utf8')
    if (!src.includes('createAdminClient')) continue // solo las que bypassan RLS
    if (!/export async function GET\b/.test(src)) continue // solo con handler de lectura
    total++
    if (ALLOWLIST.has(rel)) continue // preview publico justificado
    if (!tieneprimitivaDeAcceso(src)) gaps.push('/src/app/api/' + rel)
  }

  it('encuentra las rutas GET+admin sobre id dinamico (el scan no esta vacio)', () => {
    expect(total).toBeGreaterThanOrEqual(40)
  })

  it('ningun GET+admin sobre id dinamico lee sin primitiva de acceso (salvo allowlist)', () => {
    expect(gaps.sort()).toEqual([])
  })
})

/**
 * Tripwire de AUTORIZACION para los subrecursos de un workspace (sexto gemelo,
 * tras task/note/project/team/space). Toda ruta bajo
 * src/app/api/workspaces/[workspaceId] que exporte un handler mutante debe
 * autorizar al usuario sobre ESE workspace. La mayoria de estas rutas usan el
 * admin client (bypassa RLS), asi que sin el check un user autenticado podria
 * mutar el workspace de otra organizacion (config, miembros, roles, metas,
 * invites, ubicacion desde el lobby) con solo adivinar el workspaceId (IDOR /
 * BOLA), incluida escalada de privilegios (promover a owner/admin).
 *
 * A DIFERENCIA de los gemelos block-level (task/note/team/space) y AL IGUAL que
 * el gemelo de proyecto, aqui el contrato es por ARCHIVO. Motivo: los helpers de
 * acceso de estas rutas son heterogeneos y a nivel de MODULO (isAdmin, isOwner,
 * hasWorkspaceAccess), asi que un scan por bloque no los ve dentro del cuerpo del
 * handler. Se exige que el archivo contenga una PRIMITIVA DE AUTORIZACION que es
 * justo lo que esos helpers usan:
 *   - isWorkspaceAdminById(  compuerta solo-admin del workspace (config, miembros,
 *                            roles, lobby).
 *   - workspace_members      lectura directa de la membresia/rol del workspace
 *                            (goals: hasWorkspaceAccess; invites: isAdmin/isOwner).
 *   - org_role               compuerta de admin/owner de la organizacion (parte de
 *                            los mismos helpers de acceso).
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * ALLOWLIST (minima y justificada, nunca un silencio):
 *   - invites/[inviteId]/route.ts (DELETE, revocar invite): NO usa el admin
 *     client. Muta workspace_invites con el client de SESION del usuario
 *     (createClient), asi que la RLS restringe la revocacion a admins por
 *     construccion (una fila que el user no puede tocar devuelve 0 filas -> 403).
 *     No hay bypass de RLS que autorizar en codigo, por eso no lleva primitiva.
 *
 * Hoy 6 archivos con handler mutante (7 handlers) autorizan. Un subrecurso nuevo
 * debe apoyarse en una de estas primitivas, o (si muta solo via client de sesion
 * bajo RLS) justificarse aqui como el revoke de invites. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SUBRES = join(process.cwd(), 'src', 'app', 'api', 'workspaces', '[workspaceId]')

/** Recorre un dir y devuelve rutas absolutas de archivos route.ts. */
function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const ALLOWLIST = new Set<string>([
  '/src/app/api/workspaces/[workspaceId]/invites/[inviteId]/route.ts',
])

const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/g
const AUTHZ = /isWorkspaceAdminById\(|workspace_members|org_role/

const files = walkRoutes(SUBRES)

describe('Invariante de authz: subrecurso mutante de workspace autoriza al usuario sobre el workspace', () => {
  const gaps: string[] = []
  let totalMutating = 0
  for (const file of files) {
    const rel = file.replace(process.cwd(), '').replace(/\\/g, '/')
    const src = readFileSync(file, 'utf8')
    const count = src.match(MUTATING)?.length ?? 0
    if (count === 0) continue
    totalMutating += count
    if (ALLOWLIST.has(rel)) continue
    if (!AUTHZ.test(src)) gaps.push(rel)
  }

  it('encuentra archivos con handler mutante (el scan no esta vacio)', () => {
    expect(totalMutating).toBeGreaterThanOrEqual(7)
  })

  it('ningun archivo con subrecurso mutante carece de primitiva de autorizacion', () => {
    expect(gaps).toEqual([])
  })
})

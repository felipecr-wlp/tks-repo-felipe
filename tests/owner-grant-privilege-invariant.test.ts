/**
 * Tripwire de ESCALADA DE PRIVILEGIOS AL ROL OWNER (privilege escalation via
 * mass assignment del campo `role`, OWASP A01 Broken Access Control).
 *
 * En un workspace el rol `owner` es la cuspide: controla facturacion, borrado del
 * workspace y la promocion de otros. El resto (`admin`, `manager`, `member`,
 * `viewer`) esta por debajo. La regla dura del control de acceso: un `admin` comun
 * puede repartir roles de admin y por debajo, pero SOLO un `owner` puede OTORGAR el
 * rol owner. Sin esa barrera, cualquier admin se autopromueve (o promueve a un
 * complice) a owner y se apodera del workspace: escalada de privilegios.
 *
 * El vector es "mass assignment": un handler que ESCRIBE `workspace_members.role`
 * con un valor que viene del cuerpo del request. Dos endpoints lo hacen con un rol
 * controlado por el usuario y capaz de valer 'owner':
 *   - members/[memberId] PATCH : cambia el rol de un miembro.
 *   - lobby POST               : ubica a un perfil de la sala de espera con un rol.
 * AMBOS deben cortar con `role === 'owner' && !isOwner -> 403`. (Este test nacio de
 * un hallazgo real: el lobby otorgaba owner con solo ser admin; se cerro con la
 * misma barrera que ya tenia el PATCH de miembros.)
 *
 * Contrato, cuatro aristas:
 *   A) Los dos writers owner-capaces (lobby, members/[memberId]) contienen la
 *      barrera: `role === 'owner'` gateado por `isOwner` con un 403.
 *   B) DISCIPLINA DE ENUM: en TODO route.ts, un campo `role:` en un schema de zod se
 *      declara con `z.enum(`, nunca `z.string()`/`z.any()`. Un rol de texto libre es
 *      mass assignment de un rol arbitrario.
 *   C) Un invite NUNCA acuña un owner: el enum de rol del invite excluye 'owner'
 *      (un flujo self-service no puede mintear la cuspide).
 *   D) ANTI-REGRESION: el conjunto de route.ts que ESCRIBEN workspace_members
 *      (insert/update/upsert) es EXACTAMENTE el registro auditado. Un writer nuevo
 *      rompe el test y fuerza revisar si su `role` necesita la barrera.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy los 2 writers owner-capaces cortan la promocion a owner de un no-owner. Aflojar
 * cualquiera, o agregar un writer nuevo sin revisar, cae aqui. Nunca un silencio.
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

// Un WRITE a workspace_members: from('workspace_members').(insert|update|upsert(
const WRITES_WS_MEMBERS =
  /from\(['"]workspace_members['"]\)\s*\.\s*(?:insert|update|upsert)\b/
// La barrera: la promocion a owner exige ser owner (isOwner) y responde 403.
const OWNER_BARRIER = /role\s*===\s*['"]owner['"]/
// Un campo role: en un schema de zod que NO sea z.enum( (texto libre = peligro).
const ROLE_NOT_ENUM = /role:\s*z\.(?!enum\b)\w+/

// Registro auditado de route.ts que escriben workspace_members. onboarding inserta
// role:'admin' LITERAL (el creador se vuelve admin); invites/[code]/join inserta
// invite.role (enum sin owner); lobby y members/[memberId] escriben un rol controlado
// por el usuario y capaz de owner: esos dos llevan barrera.
//
// `workspaces/route.ts` ESTUVO aqui y ya no: su POST creaba el workspace e insertaba
// al creador como admin, pero la creacion de workspaces se retiro por decision de
// producto y hoy la ruta es un 403 duro sin tocar la base. Sacarlo del registro a
// secas seria cambiar un rojo por un silencio: el dia que alguien reabra la creacion,
// el writer vuelve y nadie se entera de que su `role` necesita revision. Por eso la
// baja no se borra, se CONVIERTE en el hecho que la justifica, comprobado abajo: la
// ruta sigue cerrada. Si se reabre, ese test cae y obliga a re-auditar el writer.
const REGISTRY = [
  '/app/api/invites/[code]/join/route.ts',
  '/app/api/onboarding/route.ts',
  '/app/api/workspaces/[workspaceId]/lobby/route.ts',
  '/app/api/workspaces/[workspaceId]/members/[memberId]/route.ts',
]

const WORKSPACES = join(API, 'workspaces', 'route.ts')

const LOBBY = join(API, 'workspaces', '[workspaceId]', 'lobby', 'route.ts')
const MEMBERS = join(API, 'workspaces', '[workspaceId]', 'members', '[memberId]', 'route.ts')
const INVITES = join(API, 'workspaces', '[workspaceId]', 'invites', 'route.ts')

describe('Invariante: solo un owner puede otorgar el rol owner (anti escalada de privilegios)', () => {
  const files = walkRoutes(API)

  it('el scan encuentra la superficie de rutas (no esta vacio)', () => {
    expect(files.length).toBeGreaterThanOrEqual(60)
  })

  // Arista A: los dos writers owner-capaces cortan la promocion a owner.
  it('lobby POST corta la promocion a owner de un no-owner (owner + isOwner + 403)', () => {
    const src = readFileSync(LOBBY, 'utf8')
    expect(src).toMatch(OWNER_BARRIER)
    expect(src).toMatch(/isOwner/)
    expect(src).toMatch(/role\s*===\s*['"]owner['"][\s\S]{0,120}?403/)
  })

  it('members/[memberId] PATCH corta la promocion a owner de un no-owner (owner + isOwner + 403)', () => {
    const src = readFileSync(MEMBERS, 'utf8')
    expect(src).toMatch(OWNER_BARRIER)
    expect(src).toMatch(/isOwner/)
    expect(src).toMatch(/role\s*===\s*['"]owner['"][\s\S]{0,120}?403/)
  })

  // Arista B: disciplina de enum. Ningun role: de zod es texto libre.
  it('todo campo role de un schema de zod se declara con z.enum (no z.string)', () => {
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (ROLE_NOT_ENUM.test(src)) {
        offenders.push(file.replace(SRC, '').replace(/\\/g, '/'))
      }
    }
    expect(offenders.sort()).toEqual([])
  })

  // Arista C: un invite nunca acuña un owner.
  it('el enum de rol del invite excluye owner (no mintea la cuspide)', () => {
    const src = readFileSync(INVITES, 'utf8')
    expect(src).toMatch(/role:\s*z\.enum\(/)
    expect(src).not.toMatch(/role:\s*z\.enum\(\[[^\]]*owner/)
  })

  // La contraparte de haber sacado workspaces/route.ts del registro: sigue siendo una
  // ruta cerrada que no escribe la tabla. Si vuelve a crear workspaces, esto se pone
  // rojo ANTES que la arista D y dice exactamente que hay que volver a auditar.
  it('workspaces/route.ts sigue cerrada (no volvio a escribir membresias sin auditar)', () => {
    const src = readFileSync(WORKSPACES, 'utf8')
    expect(src).toMatch(/status:\s*403/)
    expect(WRITES_WS_MEMBERS.test(src)).toBe(false)
  })

  // Arista D: anti-regresion. El conjunto de writers de workspace_members es el registro.
  it('el conjunto de rutas que escriben workspace_members es exactamente el registro', () => {
    const discovered: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (!WRITES_WS_MEMBERS.test(src)) continue
      discovered.push(file.replace(SRC, '').replace(/\\/g, '/'))
    }
    expect(discovered.sort()).toEqual([...REGISTRY].sort())
  })
})

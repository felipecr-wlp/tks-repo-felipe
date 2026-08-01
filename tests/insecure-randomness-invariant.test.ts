/**
 * Tripwire de ALEATORIEDAD INSEGURA (CWE-338: uso de un PRNG no criptografico
 * para generar un secreto).
 *
 * Math.random() NO es criptograficamente seguro: su salida es predecible a partir
 * de unas pocas muestras (el estado del generador se recupera). Si alguna vez se
 * usara para acuñar un SECRETO (un codigo de invitacion que da acceso a un
 * workspace, un `state` de OAuth que ata la vuelta del login, un salt de password,
 * un token de share), un atacante podria PREDECIR el valor y colarse: adivinar el
 * codigo de invitacion, forjar el state para saltarse el CSRF del OAuth, etc. La
 * defensa es acuñar TODO secreto con el CSPRNG del runtime (`crypto.randomBytes` /
 * `crypto.randomUUID`), nunca con Math.random.
 *
 * Contrato, dos aristas:
 *   A) Los tres acuñadores de secreto conocidos usan el CSPRNG y NUNCA Math.random:
 *        - lib/invite-code.ts   -> randomBytes (codigo de invitacion a workspace)
 *        - lib/password.ts      -> randomBytes (salt del PBKDF2)
 *        - api/google/connect   -> randomBytes (state anti-CSRF del OAuth)
 *   B) ANTI-REGRESION ESTRUCTURAL: se descubre TODO archivo de src que use
 *      Math.random y se exige que el conjunto sea EXACTAMENTE el registro de
 *      sitios BENIGNOS de abajo (rompe-colisiones de slug y un serial cosmetico de
 *      certificado, ninguno es una frontera de seguridad). Un Math.random nuevo en
 *      un archivo no registrado rompe el test y fuerza revision consciente: si es
 *      un secreto, hay que migrarlo a randomBytes; si es benigno, registrarlo aqui.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 3 acuñadores de secreto usan CSPRNG y 7 sitios usan Math.random, los 7
 * benignos (6 slugs + 1 serial de certificado). 0 secretos con PRNG debil. Un
 * acuñador nuevo con Math.random cae aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')

function walkSrc(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkSrc(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

const USES_MATH_RANDOM = /Math\.random\(/

// Registro: sitios BENIGNOS que pueden usar Math.random (no acuñan secretos).
// Rutas relativas a src/, con separador "/". Son rompe-colisiones de slug, el
// serial cosmetico de un certificado y la dispersion visual del editor de flujos
// (ninguno autentica nada).
const BENIGN: string[] = [
  '/app/api/academy/certificate/route.ts',        // serial visible del certificado
  '/app/api/marketplace/propose/route.ts',        // desambiguador de slug
  '/app/api/onboarding/route.ts',                 // desambiguador de slug (org + ws)
  '/app/api/projects/route.ts',                   // desambiguador de slug
  '/app/api/teams/route.ts',                      // desambiguador de slug
  // Nota: /app/api/workspaces/route.ts salio del registro. En 8797c02 se cerro la
  // creacion de workspaces (el POST responde 403) y con ella se fue el codigo de
  // slug que usaba Math.random. El registro es un conjunto EXACTO, asi que un
  // sitio benigno que desaparece tambien hay que darlo de baja.
  '/components/tasks/ManageCustomFieldsModal.tsx',// slug de opcion de campo
  // Editor de flujos: dispersa la posicion inicial de un nodo nuevo en el lienzo
  // (para que no se apilen todos en el mismo punto) y agrega 4 caracteres al id de
  // un nodo duplicado, que ya lleva Date.now() delante. Ninguno autentica ni
  // autoriza: si dos ids chocaran, el peor caso es un nodo repetido en un
  // diagrama, no un acceso.
  '/app/(app)/w/[workspaceSlug]/flows/[flowId]/FlowEditor.tsx',
]

describe('Invariante: ningun secreto se acuña con un PRNG no criptografico', () => {
  const files = walkSrc(SRC)

  it('el scan recorre el arbol de fuentes (no esta vacio)', () => {
    expect(files.length).toBeGreaterThanOrEqual(200)
  })

  // Arista A: los acuñadores de secreto usan CSPRNG y no Math.random.
  it('el generador de codigos de invitacion usa randomBytes, no Math.random', () => {
    const src = readFileSync(join(SRC, 'lib', 'invite-code.ts'), 'utf8')
    expect(src).toMatch(/randomBytes\(/)
    expect(USES_MATH_RANDOM.test(src)).toBe(false)
  })

  it('el salt de password usa randomBytes, no Math.random', () => {
    const src = readFileSync(join(SRC, 'lib', 'password.ts'), 'utf8')
    expect(src).toMatch(/randomBytes\(/)
    expect(USES_MATH_RANDOM.test(src)).toBe(false)
  })

  it('el state anti-CSRF del OAuth de Google usa randomBytes, no Math.random', () => {
    const src = readFileSync(join(SRC, 'app', 'api', 'google', 'connect', 'route.ts'), 'utf8')
    expect(src).toMatch(/randomBytes\(/)
    expect(USES_MATH_RANDOM.test(src)).toBe(false)
  })

  // Arista B: todo uso de Math.random esta en la lista de benignos (anti-regresion).
  it('todo uso de Math.random esta en el registro de sitios benignos (ninguno acuña secreto)', () => {
    const discovered: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (!USES_MATH_RANDOM.test(src)) continue
      discovered.push(file.replace(SRC, '').replace(/\\/g, '/'))
    }
    expect(discovered.sort()).toEqual([...BENIGN].sort())
  })
})

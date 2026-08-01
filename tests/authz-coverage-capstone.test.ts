/**
 * CAPSTONE de AUTORIZACION: convierte el conjunto de tripwires de authz en un
 * sistema CERRADO. Cada tripwire por familia (S33-S43) demuestra que SUS handlers
 * mutantes autorizan; este meta-test demuestra que NO EXISTE una familia mutante
 * sin tripwire. Es la red que atrapa el hueco que los demas no pueden ver: una
 * ruta mutante nueva bajo un directorio de primer nivel NUEVO (p. ej.
 * src/app/api/webhooks/route.ts) no la vigila ningun tripwire existente; aqui
 * falla hasta que se le da su propio tripwire y se registra su familia.
 *
 * Mecanica: enumera TODA la superficie mutante (POST/PATCH/PUT/DELETE) de
 * src/app/api y exige que la FAMILIA de primer nivel de cada route.ts este en el
 * registro COVERED, donde cada entrada apunta al tripwire que la vigila. Una
 * familia mutante fuera del registro = gap.
 *
 * Registro familia -> tripwire guardian:
 *   tasks         -> task-subresource-authz-invariant (+ collection-creator)
 *   notes         -> note-subresource-authz-invariant (+ collection-creator)
 *   projects      -> project-subresource-authz-invariant (+ collection-creator)
 *   teams         -> team-subresource-authz-invariant (+ collection-creator)
 *   spaces        -> space-subresource-authz-invariant (+ collection-creator)
 *   workspaces    -> workspace-subresource-authz-invariant (+ collection-creator)
 *   goals         -> leaf-resource-authz-invariant
 *   sprints       -> leaf-resource-authz-invariant
 *   whiteboards   -> leaf-resource-authz-invariant
 *   time-entries  -> leaf-resource-authz-invariant
 *   profile       -> self-scoped-mutation-invariant
 *   onboarding    -> self-scoped-mutation-invariant
 *   notifications -> self-scoped-mutation-invariant
 *   invites       -> self-scoped-mutation-invariant (join) + workspace-subresource (revoke)
 *   daily-reports -> self-scoped-mutation-invariant (cada quien escribe SU dia)
 *   academy       -> academy-authz-invariant
 *   applications  -> misc-endpoint-authz-invariant
 *   messages      -> misc-endpoint-authz-invariant
 *   marketplace   -> misc-endpoint-authz-invariant
 *   kern          -> misc-endpoint-authz-invariant (allowlist justificado: IA authN-only)
 *   flows         -> flows-authz-invariant (gate por ruta + tabla de verdad de resolveFlowAccess)
 *   content       -> content-authz-invariant (planificador de contenido)
 *
 * El interruptor del marketplace NO es familia propia: vive en
 * workspaces/[workspaceId]/tools, asi que ya lo vigila el tripwire de subrecursos
 * de workspace. Ademas tiene el suyo (marketplace-tools-invariant), que no es de
 * authz sino de forma: prohibe que instalar vuelva a significar subir codigo.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 19 familias, 111 handlers mutantes, todas con guardian. Una familia mutante
 * nueva debe registrarse aqui apuntando a su tripwire. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api')

/** Recorre un dir y devuelve rutas absolutas de archivos route.ts. */
function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const MUTATING = /export async function (POST|PATCH|PUT|DELETE)\b/g

// Familias de primer nivel con tripwire de authz dedicado (ver cabecera).
const COVERED = new Set<string>([
  'tasks', 'notes', 'projects', 'teams', 'spaces', 'workspaces',
  'goals', 'sprints', 'whiteboards', 'time-entries',
  'profile', 'onboarding', 'notifications', 'invites', 'daily-reports',
  'academy', 'applications', 'messages', 'marketplace', 'kern',
  'flows', 'content',
])

describe('Capstone de authz: ninguna familia mutante de src/app/api escapa a su tripwire', () => {
  const uncovered = new Set<string>()
  let totalMutating = 0
  const seenFamilies = new Set<string>()

  for (const file of walkRoutes(API)) {
    const src = readFileSync(file, 'utf8')
    const count = src.match(MUTATING)?.length ?? 0
    if (count === 0) continue
    totalMutating += count
    const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')
    const family = rel.split('/')[0]
    seenFamilies.add(family)
    if (!COVERED.has(family)) uncovered.add(family)
  }

  it('la superficie mutante no esta vacia (el scan corre)', () => {
    expect(totalMutating).toBeGreaterThanOrEqual(100)
  })

  it('toda familia mutante tiene un tripwire de authz registrado', () => {
    expect([...uncovered].sort()).toEqual([])
  })

  it('el registro COVERED no tiene familias muertas (todas las registradas existen en el arbol)', () => {
    const dead = [...COVERED].filter(f => !seenFamilies.has(f))
    expect(dead.sort()).toEqual([])
  })
})

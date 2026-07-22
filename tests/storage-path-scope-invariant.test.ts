/**
 * Tripwire de SCOPE DE PATH EN STORAGE (IDOR de descarga / subida cross-tenant).
 *
 * Las operaciones de Storage se hacen con el admin client (service_role), que NO
 * respeta RLS del bucket: firma, sube o borra CUALQUIER path que se le pase. Si un
 * handler firmara (createSignedUrl) o borrara (remove) un path DERIVADO del cliente
 * sin atarlo al tenant, un atacante descargaria o destruiria archivos de otro equipo
 * o tarea con solo cambiar el path. La defensa es doble: (1) un GATE de acceso al
 * recurso de la URL, y (2) que el path quede ACOTADO al scope, ya sea porque se
 * construye server-side con un prefijo `team/<teamId>/` o `task/<taskId>/`, porque
 * se exige startsWith(prefijo), o porque el path sale de una fila de DB atada al
 * recurso (att.task_id === taskId, .eq('task_id', taskId)).
 *
 * Deteccion estructural: se descubre TODO route.ts que toca admin.storage.from(...)
 * y se exige que el conjunto sea EXACTAMENTE el registro de abajo (un handler de
 * storage nuevo sin registrar rompe el test). Cada archivo debe contener sus dos
 * primitivas: el gate de acceso y el acotamiento del path.
 *
 * Registro archivo -> [gate de acceso, acotamiento de path]:
 *   - teams/[teamId]/chat-files/sign   -> canAccessTeamById + startsWith(prefix)
 *   - teams/[teamId]/chat-files        -> canAccessTeamById + path `team/${teamId}/`
 *   - tasks/[taskId]/attachments       -> loadTaskWithAccess + path `task/${taskId}/`
 *   - tasks/[taskId]/attachments/[attachmentId] -> att.task_id === taskId + membresia
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 4 handlers tocan storage; los 4 gatean y acotan el path; 0 IDOR de storage.
 * Un handler de storage nuevo debe gatear, acotar y registrarse aqui. Nunca un
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

const TOUCHES_STORAGE = /\.storage\.from\(/

// Registro: archivo -> primitivas requeridas (todas deben aparecer).
const REGISTRY: Record<string, RegExp[]> = {
  'teams/[teamId]/chat-files/sign/route.ts': [/canAccessTeamById\(/, /startsWith\(prefix\)/],
  'teams/[teamId]/chat-files/route.ts':      [/canAccessTeamById\(/, /team\/\$\{params\.teamId\}\//],
  'tasks/[taskId]/attachments/route.ts':     [/loadTaskWithAccess\(/, /task\/\$\{params\.taskId\}\//],
  'tasks/[taskId]/attachments/[attachmentId]/route.ts': [/att\.task_id !== params\.taskId/, /project_members/],
}

describe('Invariante: toda operacion de storage con admin client acota el path al tenant', () => {
  const discovered: string[] = []
  const gaps: string[] = []

  for (const file of walkRoutes(API)) {
    const src = readFileSync(file, 'utf8')
    if (!TOUCHES_STORAGE.test(src)) continue
    const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')
    discovered.push(rel)
    const primitives = REGISTRY[rel]
    if (!primitives || !primitives.every(re => re.test(src))) gaps.push('/src/app/api/' + rel)
  }

  it('el conjunto de handlers de storage descubierto es exactamente el registrado', () => {
    expect(discovered.sort()).toEqual(Object.keys(REGISTRY).sort())
  })

  it('todo handler de storage gatea el acceso y acota el path al tenant', () => {
    expect(gaps.sort()).toEqual([])
  })
})

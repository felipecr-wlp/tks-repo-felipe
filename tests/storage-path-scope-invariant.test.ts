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
 *   - workspace/[workspaceId]/chat-files      -> canAccessWorkspaceById + path `workspace/${workspaceId}/`
 *   - workspace/[workspaceId]/chat-files/sign -> canAccessWorkspaceById + startsWith(prefix)
 *   - tasks/[taskId]/attachments       -> loadTaskWithAccess + taskFilePrefix(taskId)
 *   - tasks/[taskId]/attachments/upload-url   -> loadTaskWithAccess + taskFilePrefix(taskId)
 *   - tasks/[taskId]/attachments/[attachmentId] -> att.task_id === taskId + membresia
 *   - daily-reports/entries/[entryId]/images  -> loadEntryOwnership + reportImagePrefix(report_id)
 *   - daily-reports/images/[imageId]          -> loadEntryOwnership + path de la fila (image.path)
 *   - content/items/[itemId]/assets    -> loadItemAccess + contentAssetPrefix(itemId)
 *   - content/items/[itemId]           -> loadItemAccess + rutas de filas con item_id = itemId
 *   - content/assets/[assetId]         -> loadItemAccess(asset.item_id) + path de la fila
 *   - tickets/[ticketId]/files         -> puedeVer + startsWith(prefijoDeSolicitud)
 *   - tickets/[ticketId]/files/upload-url -> puedeVer + prefijoDeSolicitud(s.id)
 *
 * ── Por que la deteccion admite salto de linea ──────────────────────────────
 * La version anterior buscaba `.storage.from(` en una sola linea. Tres handlers
 * que el formateador partio en dos (`admin.storage` y `.from(BUCKET)` en lineas
 * distintas) llevaban tiempo invisibles para este tripwire: los tres si gatean,
 * pero eso fue suerte, no vigilancia. Un tripwire que se apaga con un salto de
 * linea no es un tripwire.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 18 handlers tocan storage; los 18 gatean y acotan el path; 0 IDOR de
 * storage. Un handler de storage nuevo debe gatear, acotar y registrarse aqui.
 * Nunca un silencio.
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

// `\s*` entre `.storage` y `.from(`: el encadenado se parte en varias lineas en
// cuanto el formateador lo decide, y esa ruptura no debe apagar la deteccion.
const TOUCHES_STORAGE = /\.storage\s*\.from\(/

// Registro: archivo -> primitivas requeridas (todas deben aparecer).
const REGISTRY: Record<string, RegExp[]> = {
  // Galeria de videos de la Academia: recurso DE LA ORG (no por workspace).
  // La escritura gatea por isOrgAdmin y el path lo construye el server
  // (upload-url) o se exige su prefijo (registro). La lectura firma paths que
  // salen de la FILA cargada por id, nunca del cliente.
  'academy/videos/upload-url/route.ts': [/isOrgAdmin\(/, /\$\{carpeta\}\/\$\{randomUUID\(\)\}/],
  'academy/videos/route.ts':            [/isOrgAdmin\(/, /startsWith\('videos\/'\)/],
  'academy/videos/[videoId]/route.ts':  [/isOrgAdmin\(/, /fila\.storage_path/],
  'academy/videos/[videoId]/stream/route.ts': [/video\.storage_path/, /status !== 'live'/],
  'teams/[teamId]/chat-files/sign/route.ts': [/canAccessTeamById\(/, /startsWith\(prefix\)/],
  'teams/[teamId]/chat-files/route.ts':      [/canAccessTeamById\(/, /team\/\$\{params\.teamId\}\//],
  'workspace/[workspaceId]/chat-files/route.ts':      [/canAccessWorkspaceById\(/, /workspace\/\$\{params\.workspaceId\}\//],
  'workspace/[workspaceId]/chat-files/sign/route.ts': [/canAccessWorkspaceById\(/, /startsWith\(prefix\)/],
  'tasks/[taskId]/attachments/route.ts':     [/loadTaskWithAccess\(/, /taskFilePrefix\(params\.taskId\)/],
  'tasks/[taskId]/attachments/upload-url/route.ts': [/loadTaskWithAccess\(/, /taskFilePrefix\(params\.taskId\)/],
  'tasks/[taskId]/attachments/[attachmentId]/route.ts': [/att\.task_id !== params\.taskId/, /project_members/],
  'daily-reports/entries/[entryId]/images/route.ts': [/loadEntryOwnership\(/, /reportImagePrefix\(owner\.report_id\)/],
  // El path no se construye: sale de la fila, y la fila se ata al dueño de su
  // entrada antes de firmar o borrar.
  'daily-reports/images/[imageId]/route.ts': [/loadEntryOwnership\(admin, image\.entry_id\)/, /image\.path/],
  'content/items/[itemId]/assets/route.ts':  [/loadItemAccess\(/, /contentAssetPrefix\(params\.itemId\)/],
  'content/items/[itemId]/route.ts':         [/loadItemAccess\(/, /\.eq\('item_id', params\.itemId\)/],
  'content/assets/[assetId]/route.ts':       [/loadItemAccess\(admin, asset\.item_id/, /asset\.path/],
  // El prefijo sale de `s.id`, o sea de la FILA que se cargo por el id de la
  // URL, no de nada que mande el cliente. Por eso vale como acotamiento: para
  // colar un path ajeno habria que pasar antes por `puedeVer` de esa solicitud.
  'tickets/[ticketId]/files/route.ts':            [/puedeVer\(s\)/, /\.startsWith\(prefijo/],
  'tickets/[ticketId]/files/upload-url/route.ts': [/puedeVer\(s\)/, /prefijoDeSolicitud\(s\.id\)/],
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

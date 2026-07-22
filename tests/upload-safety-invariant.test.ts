/**
 * Tripwire de SUBIDA INSEGURA DE ARCHIVOS (Unrestricted File Upload: XSS
 * almacenado, malware, DoS por tamano).
 *
 * Un endpoint que recibe un archivo del cliente y lo empuja a storage con el admin
 * client es una boca abierta al bucket. Si NO valida server-side, tres cosas se
 * rompen a la vez:
 *   - sin tope de TAMANO -> un anonimo (o un usuario cualquiera) sube gigas y agota
 *     cuota/ancho de banda: DoS y factura;
 *   - sin allowlist de CONTENT-TYPE -> se cuela un .html/.svg con script que, servido
 *     luego, ejecuta en el origen: XSS almacenado; o un ejecutable disfrazado;
 *   - sin SANEAR el nombre -> `../../otro` hace path traversal y pisa/lee objetos de
 *     otro scope.
 * La validacion del CLIENTE no cuenta: el atacante pega la request a mano. La unica
 * barrera real es el chequeo en el handler, ANTES del `.upload(`.
 *
 * Contrato: en TODO route.ts, el cuerpo del handler que llama
 * `.storage.from(...).upload(` debe, en ese mismo cuerpo:
 *   A) topar el tamano del archivo (`.size >` contra un maximo),
 *   B) exigir un allowlist de mime (`...ALLOWLIST.has(`),
 *   C) sanear el nombre (`.replace(/[^\w...` -> quita separadores de path y basura).
 * Un upload nuevo al que le falte cualquiera de las tres cae aqui.
 *
 * Deteccion estructural: se trocea cada archivo por bloque de handler (de un
 * "export async function VERBO" al siguiente) y se analiza SOLO el bloque que sube,
 * para no dejar que un chequeo de otro handler tape un upload crudo.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 2 handlers suben (task-files y chat-files) y los 2 topan tamano, exigen
 * allowlist de mime y sanean el nombre. Un upload nuevo sin validar cae aqui. Nunca
 * un silencio.
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

// El sitio de subida: `.storage.from(<bucket>).upload(`.
const UPLOADS = /\.storage\.from\([^)]*\)\.upload\(/
// Las tres barreras server-side que debe tener el MISMO cuerpo que sube.
const SIZE_CAP = /\.size\s*>/                 // topa el tamano contra un maximo
const MIME_ALLOWLIST = /ALLOWLIST\.has\(/     // exige un allowlist de content-type
const SANITIZE = /\.replace\(\/\[\^\\w/       // sanea el nombre (quita separadores)

describe('Invariante: todo handler que sube un archivo valida tamano, mime y nombre', () => {
  const files = walkRoutes(API)
  const uploadHandlers: string[] = []
  const missingSize: string[] = []
  const missingMime: string[] = []
  const missingSanitize: string[] = []

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const rel = file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')

    const marks: { verb: string; start: number }[] = []
    for (const m of src.matchAll(/export async function ([A-Z]+)\b/g)) {
      marks.push({ verb: m[1], start: m.index ?? 0 })
    }
    marks.forEach((mark, i) => {
      const end = marks[i + 1]?.start ?? src.length
      const body = src.slice(mark.start, end)
      if (!UPLOADS.test(body)) return // handler que no sube: fuera de alcance.
      const id = `/src/app/api/${rel}:${mark.verb}`
      uploadHandlers.push(id)
      if (!SIZE_CAP.test(body)) missingSize.push(id)
      if (!MIME_ALLOWLIST.test(body)) missingMime.push(id)
      if (!SANITIZE.test(body)) missingSanitize.push(id)
    })
  }

  it('el scan encuentra los handlers que suben archivos (no esta vacio)', () => {
    expect(uploadHandlers.length).toBeGreaterThanOrEqual(2)
  })

  it('todo handler que sube topa el tamano del archivo', () => {
    expect(missingSize.sort()).toEqual([])
  })

  it('todo handler que sube exige un allowlist de mime', () => {
    expect(missingMime.sort()).toEqual([])
  })

  it('todo handler que sube sanea el nombre del archivo', () => {
    expect(missingSanitize.sort()).toEqual([])
  })
})

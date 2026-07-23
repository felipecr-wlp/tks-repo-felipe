/**
 * Tripwire de URL PUBLICA DE STORAGE (Unrestricted access / CWE-284 Improper Access
 * Control; a la vez la barrera que sostiene el aislamiento cross-origin del contenido
 * subido).
 *
 * Todo archivo que sube un usuario (adjuntos de tarea, archivos de chat) vive en un
 * bucket PRIVADO y se sirve SOLO con `createSignedUrl` (URL temporal, con TTL, ligada al
 * chequeo de acceso del handler). Esa postura hace tres cosas a la vez:
 *   1. Control de acceso: sin firma no hay lectura; un ajeno no adivina la URL.
 *   2. Caducidad: la firma expira, no queda un enlace eterno.
 *   3. Aislamiento de origen: el archivo se sirve desde el dominio de storage de
 *      Supabase, NO desde el origen de la app; por eso un SVG con <script> subido como
 *      adjunto NO corre en el origen de la app ni puede robar la cookie de sesion.
 * `getPublicUrl(...)` rompe las tres: devuelve una URL PERMANENTE y PUBLICA de un objeto,
 * legible por cualquiera sin firma. Usarlo sobre contenido de usuario reabre el IDOR
 * (enlace adivinable/filtrable) y, si el bucket se marca publico, el vector de XSS
 * almacenado. Solo el contenido verdaderamente publico (nunca el subido por usuarios)
 * podria justificar una URL publica, y hoy no existe ese caso.
 *
 * Hermano de `storage-path-scope` (que ata el PATH firmado a algo validado) y
 * `chat-files-sign-scope`. Este cubre otra arista: prohibir la URL publica de raiz.
 *
 * Contrato, dos aristas duras:
 *   A) Ningun route.ts llama `.getPublicUrl(` sobre storage.
 *   B) El scan encuentra los sitios que SIRVEN contenido subido, y todos usan
 *      `createSignedUrl(` (ancla anti-silencio: si el serve deja de firmar, se nota).
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 0 getPublicUrl y 2 sitios de serve con createSignedUrl. Un getPublicUrl nuevo
 * sobre contenido de usuario cae aqui. Nunca un silencio.
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

const rel = (file: string) => file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')

const PUBLIC_URL = /\.getPublicUrl\(/
const SIGNED_URL = /\.createSignedUrl\(/

describe('Invariante: el contenido subido nunca se sirve con URL publica de storage (anti CWE-284)', () => {
  const files = walkRoutes(API)

  const publicOffenders: string[] = []
  const signedSites: string[] = []
  for (const file of files) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (PUBLIC_URL.test(line)) publicOffenders.push(`${rel(file)}:${i + 1}`)
      if (SIGNED_URL.test(line)) signedSites.push(`${rel(file)}:${i + 1}`)
    })
  }

  it('el scan encuentra los sitios que sirven contenido subido con signed URL (no esta vacio)', () => {
    expect(signedSites.length).toBeGreaterThanOrEqual(2)
  })

  it('ningun route.ts sirve storage con getPublicUrl()', () => {
    expect(publicOffenders.sort()).toEqual([])
  })
})

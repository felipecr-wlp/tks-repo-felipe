/**
 * Tripwire anti-SSRF (mismo espiritu que rate-limit-invariant y patch-strict-schema).
 *
 * Contrato: NINGUN route handler bajo src/app/api debe hacer una llamada cruda a
 * fetch(). Hoy la superficie es CERO: ningun route.ts consulta una URL externa;
 * la unica salida HTTP server-side es la integracion de Google, que va por el SDK
 * googleapis contra endpoints FIJOS de Google (no una URL del body). Si un handler
 * nuevo introdujera un fetch() a una URL derivada del request, seria un vector de
 * SSRF clasico (pivote a metadata interna, puertos locales, red privada); este
 * test lo caza antes de mergear y obliga a justificar la excepcion en la lista
 * blanca de forma visible y auditable.
 *
 * El test lee el arbol de fuentes; no monta rutas ni DB, asi que es deterministico
 * y barato. Detecta el USO real de fetch( (identificador con limite de palabra),
 * no menciones en comentarios que digan la palabra suelta.
 *
 * Si en el futuro se agrega un fetch legitimo (p.ej. un proxy de imagen con
 * validacion de host contra allowlist, o un webhook saliente con SSRF guard), se
 * declara aqui su ruta con la justificacion, nunca un silencio.
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

// Rutas con un fetch() server-side JUSTIFICADO (host validado contra allowlist /
// SSRF guard). Vacia por ahora: no existe ninguna salida HTTP cruda en los
// handlers. Mantener minima y explicita.
const ALLOWLIST = new Set<string>([])

// Uso real de fetch como llamada: identificador con limite de palabra seguido de
// parentesis (admite espacios). No matchea "prefetch(", ".fetch(" ni prosa.
const FETCH_CALL = /(?<![.\w])fetch\s*\(/

type Hit = { file: string; line: number }

const files = walkRoutes(API)

describe('Invariante anti-SSRF: ningun route handler hace fetch() crudo', () => {
  const hits: Hit[] = []
  for (const file of files) {
    const rel = file.replace(process.cwd(), '').replace(/\\/g, '/')
    if (ALLOWLIST.has(rel)) continue
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (FETCH_CALL.test(line)) hits.push({ file: rel, line: i + 1 })
    })
  }

  it('el scan recorre el arbol de rutas (no esta vacio)', () => {
    // Recuento defensivo: si el walk se rompe, no queremos un verde falso.
    expect(files.length).toBeGreaterThanOrEqual(60)
  })

  it('ningun handler introduce un sink fetch() sin justificar', () => {
    expect(hits.map(h => `${h.file}:${h.line}`)).toEqual([])
  })
})

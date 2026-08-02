/**
 * Tripwire anti stored-XSS. Fija DOS invariantes de codigo para que un cambio
 * futuro no reabra el hueco de XSS en silencio (mismo espiritu que
 * patch-strict-schema.test.ts):
 *
 *  1) Barrera REAL (render): toda inyeccion de HTML crudo via
 *     dangerouslySetInnerHTML={{ __html: ... }} debe pasar por sanitizeRichText
 *     en la misma expresion. Es el unico punto donde el HTML se pinta sin que
 *     el DOM lo re-parsee, asi que es donde vive la defensa.
 *
 *  2) Defensa en profundidad (escritura): las rutas que PERSISTEN texto
 *     enriquecido (notes.content / tasks.description), incluidas copiar,
 *     duplicar y restaurar version, deben referenciar sanitizeRichText para
 *     que ningun HTML sin sanear llegue a la fila (cubre la vista in-app Tiptap
 *     que no pasa por el saneado de render).
 *
 * El test lee el arbol de fuentes; no monta rutas ni DB, asi que es
 * deterministico y barato.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { topLevelDecls, expandirConHelpers } from './helpers/routeSource'

const SRC = join(process.cwd(), 'src')

/** Recorre src y devuelve rutas absolutas de archivos .ts/.tsx. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

const files = walk(SRC)

describe('XSS invariante 1: todo sink de render sanea', () => {
  // Solo el USO real (atributo JSX), nunca menciones en comentarios/prosa.
  const SINK = /dangerouslySetInnerHTML\s*=\s*\{\{/

  /**
   * ¿El HTML sale de un normalizador LOCAL que sanea en TODAS sus salidas?
   *
   * El patron real que motivo esto:
   *
   *   function summaryToHtml(raw: string | null): string {
   *     if (!raw || !raw.trim()) return ''
   *     const html = raw.trimStart().startsWith('<') ? raw : markdownToRichText(raw)
   *     return sanitizeRichText(html)          // <- la barrera, fuera del sink
   *   }
   *   <div dangerouslySetInnerHTML={{ __html: summaryToHtml(r.summary) }} />
   *
   * Exigir la palabra `sanitizeRichText` pegada al sink obliga a repetir el
   * saneado en cada punto de pintado, que es justo lo contrario de lo que uno
   * quiere: una sola funcion que lo haga bien. Pero tampoco vale creerle a la
   * funcion por su nombre. Se exige que CADA return del normalizador sea o una
   * constante o algo saneado; si alguien mete un camino que devuelve el HTML
   * crudo, el sink vuelve a estar descubierto y esto lo caza.
   */
  function saneaPorNormalizadorLocal(src: string, ventana: string): boolean {
    const m = ventana.match(/__html:\s*([A-Za-z_$][\w$]*)\s*\(/)
    if (!m) return false
    const decls = topLevelDecls(src)
    const objetivo = decls.find((d) => d.name === m[1])
    if (!objetivo) return false

    const texto = expandirConHelpers(objetivo, decls)
    if (!/sanitizeRichText\(/.test(texto)) return false

    const returns = [...objetivo.body.matchAll(/\breturn\s+([^\n]*)/g)].map((r) => r[1].trim())
    if (returns.length === 0) return false
    return returns.every(
      (r) => /sanitizeRichText\(/.test(r) || /^(''|""|`\s*`|null|undefined)/.test(r)
    )
  }

  const sinks: { file: string; line: number; window: string; sanea: boolean }[] = []
  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    const lines = src.split('\n')
    lines.forEach((line, i) => {
      if (SINK.test(line)) {
        // El __html suele ir en la misma linea; se abre una ventana de 2 lineas
        // por robustez ante formateo.
        const window = `${line}\n${lines[i + 1] ?? ''}`
        sinks.push({
          file: file.replace(SRC, 'src'),
          line: i + 1,
          window,
          sanea: /sanitizeRichText/.test(window) || saneaPorNormalizadorLocal(src, window),
        })
      }
    })
  }

  it('encuentra al menos los 2 sinks conocidos (el scan no esta vacio)', () => {
    expect(sinks.length).toBeGreaterThanOrEqual(2)
  })

  it('cada sink pasa por sanitizeRichText', () => {
    const unsanitized = sinks.filter(s => !s.sanea)
    expect(unsanitized.map(s => `${s.file}:${s.line}`)).toEqual([])
  })
})

describe('XSS invariante 2: las rutas que persisten texto enriquecido sanean al escribir', () => {
  // Rutas que escriben notes.content o tasks.description (crear, editar, copiar,
  // duplicar, restaurar). Si una pierde el saneado, este test lo caza.
  const WRITE_ROUTES = [
    'app/api/notes/route.ts',
    'app/api/notes/[noteId]/route.ts',
    'app/api/notes/[noteId]/duplicate/route.ts',
    'app/api/notes/[noteId]/versions/[versionId]/restore/route.ts',
    'app/api/tasks/route.ts',
    'app/api/tasks/[taskId]/route.ts',
    'app/api/tasks/[taskId]/duplicate/route.ts',
  ]

  for (const rel of WRITE_ROUTES) {
    it(`${rel} referencia sanitizeRichText`, () => {
      const src = readFileSync(join(SRC, ...rel.split('/')), 'utf8')
      expect(src).toContain('sanitizeRichText')
    })
  }
})

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

  const sinks: { file: string; line: number; window: string }[] = []
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((line, i) => {
      if (SINK.test(line)) {
        // El __html suele ir en la misma linea; se abre una ventana de 2 lineas
        // por robustez ante formateo.
        const window = `${line}\n${lines[i + 1] ?? ''}`
        sinks.push({ file: file.replace(SRC, 'src'), line: i + 1, window })
      }
    })
  }

  it('encuentra al menos los 2 sinks conocidos (el scan no esta vacio)', () => {
    expect(sinks.length).toBeGreaterThanOrEqual(2)
  })

  it('cada sink pasa por sanitizeRichText', () => {
    const unsanitized = sinks.filter(s => !/sanitizeRichText/.test(s.window))
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

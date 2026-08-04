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

/**
 * Rutas con un fetch() server-side JUSTIFICADO. Mantener minima y explicita.
 *
 * `/api/connectors/apps/comprobar`: comprueba la URL de una herramienta ANTES de
 * proponerla. Es SSRF por definicion (el servidor visita una URL escrita por una
 * persona) y por eso el permiso esta acotado a mano: solo https, se resuelve el
 * DNS y se rechaza si CUALQUIERA de las direcciones es interna, no se siguen
 * redirecciones, y jamas se devuelve el cuerpo, solo el codigo y dos cabeceras.
 * Existe porque las tres formas de "no carga" (no responde, redirige al login del
 * hosting, se niega a ser enmarcada) son invisibles desde el formulario y se
 * descubrian dias despues mirando un recuadro en blanco.
 */
const ALLOWLIST = new Set<string>([
  '/src/app/api/connectors/apps/comprobar/route.ts',
])

/**
 * Guardas que una ruta con fetch() justificado tiene que seguir teniendo. Estar
 * en la lista blanca exime del primer test, no de tener las protecciones: sin
 * esto, la lista seria un sello de goma y bastaria con que alguien borrara el
 * guard para que el tripwire siguiera en verde.
 */
const GUARDAS_OBLIGATORIAS: Record<string, RegExp[]> = {
  '/src/app/api/connectors/apps/comprobar/route.ts': [
    /validarUrlPublica/,       // solo https, sin credenciales en la URL
    /esDireccionInterna/,      // rechaza privadas, bucle local, enlace local y metadatos
    /redirect:\s*'manual'/,    // seguir una redireccion esquivaria lo anterior
    /AbortSignal\.timeout/,    // no se cuelga esperando a un host que no contesta
  ],
}

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

  it('toda ruta de la lista blanca existe y conserva sus guardas', () => {
    for (const rel of ALLOWLIST) {
      const full = join(process.cwd(), rel.replace(/^\//, ''))
      // Si la ruta se borro o se movio, la entrada quedo huerfana y hay que
      // limpiarla: una lista blanca que nombra archivos que no existen deja de
      // significar algo.
      expect(files.map(f => f.replace(process.cwd(), '').replace(/\\/g, '/')), `entrada huerfana en la lista blanca: ${rel}`).toContain(rel)

      const src = readFileSync(full, 'utf8')
      for (const guarda of GUARDAS_OBLIGATORIAS[rel] ?? []) {
        expect(guarda.test(src), `${rel} perdio la guarda ${guarda}`).toBe(true)
      }
    }
  })
})

/**
 * Tripwire de AUTORIZACION del planificador de contenido (src/app/api/content).
 *
 * Todos los handlers de esta familia leen y escriben con el admin client, que se
 * salta RLS. O sea que las policies de la migracion son la red de abajo y el
 * candado REAL es el codigo. Este tripwire vigila ese candado en tres capas
 * distintas, porque cada una falla de una forma que las otras no ven:
 *
 *   1. ESTRUCTURAL. Todo route.ts bajo /api/content esta registrado abajo con su
 *      primitiva de acceso. Una ruta nueva sin registrar rompe el test, que es
 *      justo lo que impide que alguien agregue un endpoint sin gate y nadie se
 *      entere.
 *
 *   2. DE REGLA. `motivoParaNegarCambioDeEstado` se ejerce con la tabla de
 *      verdad completa. Es la unica decision con consecuencias del planificador
 *      (aprobar y publicar), y esta escrita una sola vez a proposito: una regla
 *      de permisos reimplementada en seis rutas se rompe en la sexta.
 *
 *   3. DE INSTALACION. La herramienta es del marketplace, asi que su superficie
 *      solo debe existir donde se instalo. `effectiveHidden` es lo que apaga la
 *      pantalla en el sidebar, la paleta y el guardia de rutas a la vez.
 *
 * ── La trampa concreta que vigila la capa 2 ─────────────────────────────────
 * Si aprobar no fuera de mando, cualquiera moveria su propia pieza a "aprobado"
 * y la columna "por aprobar" quedaria siempre vacia: la herramienta seguiria
 * pintandose igual, sin que nadie revise nada. Es un fallo silencioso, no un
 * error. Por eso se prueba el veredicto y no el color del boton.
 *
 * Determinista: solo lee fuentes y funciones puras, no monta rutas ni DB.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { motivoParaNegarCambioDeEstado } from '@/lib/content/access'
import { effectiveHidden, INSTALLABLE_FEATURES, isInstallable } from '@/lib/features'
import { CONTENT_STATUSES, type ContentStatus } from '@/lib/content/catalog'

const API = join(process.cwd(), 'src', 'app', 'api', 'content')

function walkRoutes(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkRoutes(full, out)
    else if (entry === 'route.ts') out.push(full)
  }
  return out
}

const rel = (file: string) => file.replace(API, '').replace(/\\/g, '/').replace(/^\//, '')

/**
 * Registro archivo -> primitivas que DEBEN aparecer.
 *
 * `items/route.ts` es el unico sin `loadItemAccess`: crea la pieza, todavia no
 * hay pieza a la que subir. Su gate es la membresia del workspace consultada a
 * mano, y por eso se le exige ademas que la autoria salga de la sesion.
 */
const REGISTRY: Record<string, RegExp[]> = {
  'items/route.ts': [/workspace_members/, /created_by: user\.id/],
  'items/[itemId]/route.ts': [/loadItemAccess\(/, /motivoParaNegarCambioDeEstado\(/],
  'items/[itemId]/assets/route.ts': [/loadItemAccess\(/],
  'items/[itemId]/notes/route.ts': [/loadItemAccess\(/, /author_id: user\.id/],
  'notes/[noteId]/route.ts': [/loadItemAccess\(/],
  'assets/[assetId]/route.ts': [/loadItemAccess\(/],
}

const ESTADOS = CONTENT_STATUSES.map((e) => e.key)

describe('Invariante de authz: el planificador de contenido gatea cada ruta y cada cambio de estado', () => {
  // ── Capa 1: estructural ────────────────────────────────────────────────────
  const descubiertos = existsSync(API) ? walkRoutes(API).map(rel) : []

  it('el conjunto de rutas de /api/content es exactamente el registrado', () => {
    expect(descubiertos.sort()).toEqual(Object.keys(REGISTRY).sort())
  })

  it('toda ruta de /api/content lleva su primitiva de acceso', () => {
    const gaps: string[] = []
    for (const [archivo, primitivas] of Object.entries(REGISTRY)) {
      const full = join(API, ...archivo.split('/'))
      if (!existsSync(full)) continue
      const src = readFileSync(full, 'utf8')
      if (!primitivas.every((re) => re.test(src))) gaps.push('/src/app/api/content/' + archivo)
    }
    expect(gaps.sort()).toEqual([])
  })

  it('crear una pieza nunca acepta del cliente lo que decide el servidor', () => {
    const src = readFileSync(join(API, 'items', 'route.ts'), 'utf8')

    // Se miran los DOS bloques que podrian dejar entrar el dato, no el archivo
    // entero: `status` aparece de forma legitima como codigo HTTP
    // (`{ status: 401 }`) y en el `.select(...)` de vuelta, y buscar la palabra
    // suelta daria un falso positivo permanente.
    const bloque = (desde: string, hasta: string) => {
      const i = src.indexOf(desde)
      expect(i, `no se encontro "${desde}" en items/route.ts`).toBeGreaterThan(-1)
      const j = src.indexOf(hasta, i)
      expect(j, `no se encontro el cierre "${hasta}"`).toBeGreaterThan(i)
      return src.slice(i, j)
    }

    const esquema = bloque('const crearSchema = z.object({', '\n})')
    const insert = bloque('.insert({', '\n    })')

    // Los dos bloques deben tener contenido REAL antes de afirmar que algo NO
    // esta dentro: contra una cadena vacia toda negacion pasa sin probar nada.
    expect(esquema).toContain('network')
    expect(insert).toContain('workspace_id')

    // Campos que decide el SERVIDOR. Si alguno se pudiera mandar en el body,
    // cualquiera crearia su pieza ya aprobada y la revision no existiria: la
    // columna "por aprobar" quedaria vacia sin que nada marque error.
    for (const campo of ['status', 'rating', 'approved_by', 'approved_at', 'published_at', 'published_url']) {
      expect(esquema, `${campo} no debe poder mandarse en el body`).not.toContain(campo)
      expect(insert, `${campo} no debe escribirse desde el body al crear`).not.toContain(campo)
    }

    // La autoria sale de la sesion, nunca del cuerpo de la peticion.
    expect(insert).toContain('created_by: user.id')
  })

  // ── Capa 2: la regla que decide ────────────────────────────────────────────
  it('los tres estados del tablero son los esperados', () => {
    expect(ESTADOS).toEqual(['por_aprobar', 'aprobado', 'publicado'])
  })

  it('nadie salta de por_aprobar a publicado, ni siquiera un mando', () => {
    expect(motivoParaNegarCambioDeEstado('por_aprobar', 'publicado', true)).not.toBeNull()
    expect(motivoParaNegarCambioDeEstado('por_aprobar', 'publicado', false)).not.toBeNull()
  })

  it('quien no es mando no mueve ninguna pieza de estado', () => {
    const negadas: string[] = []
    for (const desde of ESTADOS) {
      for (const hacia of ESTADOS) {
        if (desde === hacia) continue
        const motivo = motivoParaNegarCambioDeEstado(
          desde as ContentStatus,
          hacia as ContentStatus,
          false,
        )
        if (motivo === null) negadas.push(`${desde} -> ${hacia}`)
      }
    }
    // Ninguna transicion debe quedar abierta para quien no es mando.
    expect(negadas).toEqual([])
  })

  it('un mando si aprueba, publica y regresa', () => {
    expect(motivoParaNegarCambioDeEstado('por_aprobar', 'aprobado', true)).toBeNull()
    expect(motivoParaNegarCambioDeEstado('aprobado', 'publicado', true)).toBeNull()
    expect(motivoParaNegarCambioDeEstado('aprobado', 'por_aprobar', true)).toBeNull()
    expect(motivoParaNegarCambioDeEstado('publicado', 'por_aprobar', true)).toBeNull()
  })

  it('quedarse en el mismo estado nunca es un error (un PATCH repetido no rompe)', () => {
    for (const estado of ESTADOS) {
      expect(
        motivoParaNegarCambioDeEstado(estado as ContentStatus, estado as ContentStatus, false),
      ).toBeNull()
    }
  })

  // ── Capa 3: la herramienta no existe hasta que se instala ──────────────────
  it('contenidos es una herramienta instalable del marketplace', () => {
    expect(isInstallable('contenidos')).toBe(true)
    expect(INSTALLABLE_FEATURES.map((f) => f.key)).toContain('contenidos')
  })

  it('una herramienta instalable queda oculta mientras no se instale', () => {
    expect(effectiveHidden([], [])).toContain('contenidos')
    expect(effectiveHidden([], ['contenidos'])).not.toContain('contenidos')
  })

  it('instalar una herramienta no revive lo que el admin escondio a mano', () => {
    // Las dos reglas se suman, no se pisan: `installed_features` es allow-list
    // por workspace y `hidden_features` es deny-list por persona. Si instalar
    // borrara lo escondido, el admin veria reaparecer pantallas que ya habia
    // quitado a alguien.
    // `calendar` es una clave REAL del catalogo: `normalizeHidden` descarta lo
    // que no reconoce, asi que una clave inventada aqui haria pasar el test por
    // el motivo equivocado.
    const oculto = effectiveHidden(['calendar'], ['contenidos'])
    expect(oculto).toContain('calendar')
    expect(oculto).not.toContain('contenidos')
  })

  it('una clave desconocida en installed_features no ensucia el resultado', () => {
    // Una herramienta retirada del catalogo deja su clave vieja en la columna.
    // Debe ignorarse al leer, no romper el calculo de lo que se ve.
    const oculto = effectiveHidden([], ['herramienta-que-ya-no-existe'])
    expect(oculto).toContain('contenidos')
  })
})

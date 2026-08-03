/**
 * Tripwire: una solicitud sin responder se VE hasta que se responda.
 *
 * EL DATO QUE LO MOTIVA. Al 2026-08-02 habia tres personas esperando acceso a un
 * curso de Academia, la mas antigua desde hacia cinco dias. No fue por falta de
 * aviso: las notificaciones se crearon y se leyeron. El problema es de forma, no
 * de canal. Una notificacion es un EVENTO: se lee una vez y desaparece. Una
 * solicitud pendiente es un ESTADO, y el unico lugar donde ese estado se veia era
 * /settings/academia, que nadie abre sin motivo.
 *
 * Importa porque Academia resulto ser la UNICA herramienta del workspace que la
 * gente busco sola: cinco solicitudes de cinco personas distintas en tres dias,
 * dos de ellas sin ninguna otra huella en el producto. Su unico gesto fue pedir,
 * y la respuesta fue silencio. Dejarlo asi le enseña al equipo que pedir no
 * sirve, que es exactamente lo contrario de lo que se quiere.
 *
 * Se vigilan dos cosas distintas:
 *
 *   1. QUE SE VEA. El widget de inicio le cobra al mando las solicitudes
 *      pendientes, y solo al mando (a quien no puede aprobar, enseñarle la fila
 *      es ruido). Se exige la LLAMADA a listPendingRequests detras del gate, no
 *      solo que el archivo mencione el tema.
 *
 *   2. QUE NO SE PIERDA. Al aprobar, primero se concede el acceso y despues se
 *      marca la solicitud resuelta. Al reves, si la concesion falla, la solicitud
 *      queda 'approved' sin acceso: desaparece de pendientes y el handler
 *      responde 409 a cualquier reintento. La persona espera para siempre y nadie
 *      se entera. El orden ES la garantia, por eso se comprueba por indice.
 *
 * Lee fuentes como texto. No monta DB ni rutas.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const WIDGET = join(RAIZ, 'src', 'app', '(app)', 'w', '[workspaceSlug]', 'AcademyWidget.tsx')
const HOME = join(RAIZ, 'src', 'app', '(app)', 'w', '[workspaceSlug]', 'page.tsx')
const APROBAR = join(RAIZ, 'src', 'app', 'api', 'academy', 'access', '[requestId]', 'route.ts')
const DATA = join(RAIZ, 'src', 'lib', 'academy', 'data.ts')

const leer = (p: string) => readFileSync(p, 'utf8')

function idx(src: string, re: RegExp): number {
  const m = re.exec(src)
  return m ? m.index : -1
}

describe('Invariante: una solicitud sin responder no se vuelve invisible', () => {
  it('los archivos siguen existiendo (defensa contra falso verde)', () => {
    for (const f of [WIDGET, HOME, APROBAR, DATA]) {
      expect(existsSync(f), `desaparecio ${f}`).toBe(true)
    }
  })

  it('la consulta de pendientes sigue existiendo y sigue filtrando por pending', () => {
    const src = leer(DATA)
    expect(
      /export\s+async\s+function\s+listPendingRequests/.test(src),
      'se perdio listPendingRequests: sin ella no hay forma de saber quien esta esperando',
    ).toBe(true)
    expect(
      /\.eq\(\s*['"]status['"]\s*,\s*['"]pending['"]\s*\)/.test(src),
      'listPendingRequests dejo de filtrar por status pending: devolveria tambien las ya resueltas y el aviso nunca se apagaria',
    ).toBe(true)
    // El orden ascendente no es cosmetico: [0] es la mas vieja y de ahi sale la
    // espera en dias, que es lo unico que convierte un conteo en una urgencia.
    expect(
      /\.order\(\s*['"]created_at['"]\s*,\s*\{\s*ascending:\s*true\s*\}\s*\)/.test(src),
      'listPendingRequests dejo de ordenar por created_at ascendente: la espera en dias del widget pasa a calcularse sobre una solicitud cualquiera',
    ).toBe(true)
  })

  it('el inicio le cobra al mando las solicitudes pendientes', () => {
    const src = leer(WIDGET)

    expect(
      /listPendingRequests\(\)/.test(src),
      'el widget de inicio dejo de leer las solicitudes pendientes: vuelven a existir solo en una notificacion que se lee una vez y desaparece',
    ).toBe(true)

    // Anclado al gate completo: enseñarle la fila a quien no puede aprobar no
    // ayuda a nadie y convierte el aviso en ruido, que es como muere un aviso.
    expect(
      /if\s*\(\s*await\s+isOrgAdmin\(\s*userId\s*\)\s*\)\s*\{[\s\S]{0,200}listPendingRequests\(\)/.test(src),
      'el widget dejo de condicionar las pendientes a isOrgAdmin: o se las enseña a quien no puede resolverlas, o dejo de enseñarlas del todo',
    ).toBe(true)

    expect(
      /pendientes\.length\s*>\s*0\s*&&/.test(src),
      'el widget ya no pinta el bloque de pendientes: el dato se lee y se tira',
    ).toBe(true)

    // La espera en dias es la mitad del valor del aviso. Un conteo se vuelve
    // paisaje; "5 dias sin respuesta" no.
    expect(
      /esperaMax/.test(src) && /created_at/.test(src),
      'el widget dejo de mostrar cuanto lleva esperando la mas antigua: un conteo pelado se vuelve paisaje en una semana',
    ).toBe(true)
  })

  it('el widget sigue montado en la pantalla de inicio', () => {
    expect(
      /<AcademyWidget\b/.test(leer(HOME)),
      'AcademyWidget salio del inicio: el aviso puede estar perfecto y no verlo nadie',
    ).toBe(true)
  })

  it('al aprobar se concede ANTES de marcar resuelta (si falla, falla del lado seguro)', () => {
    const src = leer(APROBAR)

    const iConcede = idx(src, /\.from\(\s*['"]academy_access['"]\s*\)\s*[\s\S]{0,80}\.upsert\(/)
    const iMarca = idx(
      src,
      /\.from\(\s*['"]academy_access_requests['"]\s*\)\s*[\s\S]{0,60}\.update\(\s*\{\s*status:/,
    )

    expect(iConcede, 'el handler de aprobacion ya no concede el acceso (upsert en academy_access)').toBeGreaterThan(-1)
    expect(iMarca, 'el handler de aprobacion ya no marca la solicitud resuelta').toBeGreaterThan(-1)

    expect(
      iConcede < iMarca,
      'se marca la solicitud como resuelta ANTES de conceder el acceso: si la concesion falla, la solicitud queda approved sin acceso, sale de la lista de pendientes y el 409 impide reintentarla. La persona espera para siempre y nadie se entera',
    ).toBe(true)

    // El 409 es correcto y por eso mismo el orden importa: es lo que vuelve
    // irreversible el estado intermedio.
    expect(
      /status:\s*409/.test(src),
      'desaparecio el 409 de solicitud ya resuelta: dos aprobaciones simultaneas volverian a poder pisarse',
    ).toBe(true)
  })
})

/**
 * Tripwire de AUTORIZACION para el modulo de SOLICITUDES.
 *
 * Los handlers mutantes bajo src/app/api/tickets usan el admin client, que
 * BYPASSA RLS. O sea que las policies de la migracion son la red de abajo y el
 * candado real es codigo. Este scan exige que cada handler que escribe tenga la
 * primitiva de su eje:
 *
 *   EJE DECISION (mover la solicitud por su flujo):
 *     - [ticketId]/route.ts -> evaluarAccion(
 *     Es la tabla de transiciones: decide en un solo lugar quien puede hacer
 *     que y desde que estado. Un handler que decida a mano, con ifs, acabaria
 *     olvidando una regla (que canalizar exige destino, que rechazar exige
 *     motivo, que el solicitante no canaliza lo suyo) sin que nada lo delate.
 *
 *   EJE ALCANCE (leer o escribir algo colgado de una solicitud ajena):
 *     - [ticketId]/comments/route.ts        -> puedeVer(
 *     - [ticketId]/watchers/route.ts        -> puedeVer(
 *     - [ticketId]/files/route.ts           -> puedeVer(
 *     - [ticketId]/files/upload-url/route.ts-> puedeVer(
 *     Sin este gate, un id de solicitud (que es adivinable) bastaria para leer
 *     el hilo de una queja ajena, sumarse a el o descargar sus adjuntos.
 *
 *   EJE AUTORIA (levantar una solicitud a nombre propio):
 *     - route.ts -> requested_by: user.id
 *     La autoria sale de la SESION, nunca del body. Si viniera del cliente,
 *     cualquiera podria levantar peticiones a nombre de otro.
 *
 * MUNDO CERRADO, NO LISTA CERRADA. El scan DESCUBRE los route.ts del arbol y
 * exige que cada handler mutante este en la tabla. Agregar una ruta sin decidir
 * su eje de autorizacion pone esto en rojo, que es justo cuando hay que
 * pensarlo. Una tabla que solo mira lo que alguien se acordo de anotar es la
 * definicion de un silencio.
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api', 'tickets')

const MUTANTES = /export async function (POST|PATCH|PUT|DELETE)\b/g

const HANDLERS: { file: string; authz: RegExp }[] = [
  { file: 'route.ts',                       authz: /requested_by: user\.id/ },
  { file: '[ticketId]/route.ts',            authz: /evaluarAccion\(/ },
  { file: '[ticketId]/comments/route.ts',   authz: /puedeVer\(/ },
  { file: '[ticketId]/watchers/route.ts',   authz: /puedeVer\(/ },
  { file: '[ticketId]/files/route.ts',      authz: /puedeVer\(/ },
  { file: '[ticketId]/files/upload-url/route.ts', authz: /puedeVer\(/ },
]

function rutasEnElArbol(dir: string): string[] {
  const out: string[] = []
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entrada.name)
    if (entrada.isDirectory()) out.push(...rutasEnElArbol(full))
    else if (entrada.name === 'route.ts') out.push(full)
  }
  return out
}

describe('Invariante de authz: los handlers de solicitudes autorizan por su eje', () => {
  const gaps: string[] = []
  let totalMutantes = 0
  for (const h of HANDLERS) {
    const full = join(API, ...h.file.split('/'))
    if (!existsSync(full)) continue
    const src = readFileSync(full, 'utf8')
    const count = src.match(MUTANTES)?.length ?? 0
    if (count === 0) continue
    totalMutantes += count
    if (!h.authz.test(src)) gaps.push('/src/app/api/tickets/' + h.file)
  }

  const anotados = new Set(HANDLERS.map((h) => h.file))
  const sinAnotar = rutasEnElArbol(API)
    .filter((full) => (readFileSync(full, 'utf8').match(MUTANTES)?.length ?? 0) > 0)
    .map((full) => relative(API, full).split(sep).join('/'))
    .filter((rel) => !anotados.has(rel))

  it('encuentra los handlers mutantes de solicitudes (el scan no esta vacio)', () => {
    expect(totalMutantes).toBeGreaterThanOrEqual(7)
  })

  it('ningun handler de solicitudes muta sin la primitiva de su eje', () => {
    expect(gaps).toEqual([])
  })

  it('ninguna ruta mutante de solicitudes se queda fuera de la tabla', () => {
    expect(
      sinAnotar,
      'Estas rutas escriben y este tripwire ni las mira. Decide su eje de autorización y anótalas arriba, o serán un silencio.',
    ).toEqual([])
  })
})

describe('Invariante: los adjuntos no se pueden reclamar de otra solicitud', () => {
  /**
   * El bucket es privado, pero el admin client firma lo que le pidan. Lo unico
   * que impide leer el adjunto de una queja ajena es que cada ruta compruebe el
   * PREFIJO `ticket/<id>/`. Es una comprobacion de una linea, invisible en un
   * code review, y sin ella el candado entero es decorativo.
   */
  const CON_PATHS = [
    '[ticketId]/files/route.ts',
    '[ticketId]/files/upload-url/route.ts',
    '[ticketId]/comments/route.ts',
  ]

  it('toda ruta que toca paths de storage usa prefijoDeSolicitud', () => {
    const sinPrefijo: string[] = []
    for (const rel of CON_PATHS) {
      const full = join(API, ...rel.split('/'))
      if (!existsSync(full)) continue
      const src = readFileSync(full, 'utf8')
      if (!/prefijoDeSolicitud\(/.test(src)) sinPrefijo.push(rel)
    }
    expect(sinPrefijo).toEqual([])
  })
})

describe('Invariante: el catalogo de tipos coincide con lo que la API acepta', () => {
  /**
   * `kind` NO tiene CHECK en la base, a proposito: el catalogo viaja con el
   * deploy. La consecuencia es que la UNICA validacion es `esTipoValido` en la
   * API. Si una ruta dejara de llamarlo, cualquier cadena entraria a la columna
   * y la pantalla mostraria solicitudes de tipo "undefined" sin un solo error.
   */
  it('crear y editar validan el tipo contra el catalogo', () => {
    for (const rel of ['route.ts', '[ticketId]/route.ts']) {
      const src = readFileSync(join(API, ...rel.split('/')), 'utf8')
      expect(/esTipoValido/.test(src), `${rel} no valida el tipo`).toBe(true)
      expect(/esPrioridadValida/.test(src), `${rel} no valida la urgencia`).toBe(true)
    }
  })

  it('los enlaces se filtran por protocolo en las dos rutas que los aceptan', () => {
    // Un `javascript:` guardado aqui se vuelve XSS en cuanto alguien lo pinte
    // como <a href>, y este campo lo llena cualquiera que pueda pedir algo.
    for (const rel of ['route.ts', '[ticketId]/route.ts']) {
      const src = readFileSync(join(API, ...rel.split('/')), 'utf8')
      expect(/esUrlSegura/.test(src), `${rel} acepta enlaces sin filtrar`).toBe(true)
    }
  })
})

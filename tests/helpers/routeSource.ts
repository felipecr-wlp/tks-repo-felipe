/**
 * Utilidad compartida de los tripwires que analizan rutas.
 *
 * ── EL PUNTO CIEGO QUE ESTO CIERRA ──────────────────────────────────────────
 * Casi todos los tripwires de seguridad cortan la fuente "de un export async
 * function VERBO al siguiente" y buscan la primitiva DENTRO de ese pedazo. Es
 * barato y determinista, pero tiene un agujero de vocabulario: cuando la ruta
 * factoriza la compuerta en un helper del MISMO archivo, la primitiva deja de
 * aparecer en el bloque y el tripwire canta hueco donde no lo hay.
 *
 * Ese patron no es una rareza, es buena practica y esta por todos lados:
 *
 *   async function loadAndGate(installId: string) {
 *     const row = await admin.from('connector_installs')...
 *     const gate = await isWorkspaceAdminById(row.workspace_id)   // <- la compuerta
 *     return { admin, row, gate }
 *   }
 *   export async function PATCH(...) {
 *     const { row, gate } = await loadAndGate(params.installId)   // <- el bloque
 *     if (!gate) return 401; if (!gate.isAdmin) return 403        //    solo ve esto
 *   }
 *
 * Un falso positivo asi no es inocuo: es RUIDO, y el ruido es como se pierde un
 * hallazgo de verdad. Un tripwire que siempre esta rojo deja de leerse, y el dia
 * que se pone rojo por una razon real nadie lo distingue de las otras catorce.
 * (El bug del rate limit sobrevivio seis semanas por lo contrario, silencio; el
 * rojo permanente es el mismo fallo por el otro extremo.)
 *
 * ── LO QUE ESTO NO HACE ─────────────────────────────────────────────────────
 * NO relaja la exigencia: sigue exigiendo que la primitiva EXISTA y que sea
 * alcanzable desde el handler. Solo deja de exigir que este literalmente en el
 * mismo bloque. La expansion es de alcance acotado a proposito:
 *
 *   - solo helpers declarados en el MISMO archivo (nada de cruzar modulos, ahi
 *     la cadena se vuelve inseguible y el tripwire empezaria a aprobar de mas),
 *   - solo si el handler los LLAMA por nombre,
 *   - con tope de profundidad y sin ciclos.
 *
 * Determinista: analisis lexico de la fuente, no monta rutas ni DB.
 *
 * ── LA UNICA EXCEPCION AL "SOLO ESTE ARCHIVO" ───────────────────────────────
 * `gateDeMembresiaVerificado` SI abre el modulo importado, pero no para creerle:
 * para COMPROBARLO. La alternativa que habia era peor, una lista blanca de
 * nombres bonitos (`canAccessProject|canAccessTeamById|...`) que aprueba por
 * como se llama una funcion y no por lo que hace, y que ademas se queda vieja
 * cada vez que nace un helper nuevo. Aqui se exige ver la consulta de membresia
 * acotada a quien pregunta dentro del modulo que la define.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Una declaracion de primer nivel del archivo: su nombre y su cuerpo. */
export interface TopLevelDecl {
  name: string
  /** El verbo si la declaracion es un handler exportado (POST, GET...), si no null. */
  verb: string | null
  start: number
  /** Texto desde la declaracion hasta la siguiente declaracion de primer nivel. */
  body: string
}

const VERBOS_MUTANTES = /^(POST|PATCH|PUT|DELETE)$/
const VERBOS = /^(GET|POST|PATCH|PUT|DELETE|HEAD|OPTIONS)$/

/**
 * Enumera las declaraciones de primer nivel (funciones y consts) en orden.
 *
 * El cuerpo de cada una se toma "hasta la siguiente declaracion", el mismo corte
 * que ya usaban los tripwires. No se hace balanceo de llaves a proposito: contar
 * llaves obliga a entender strings, plantillas, regex y comentarios, y un parser
 * a medias falla en silencio. Cortar por marcas es aproximado pero su error es
 * conocido y siempre por exceso (incluye de mas, nunca de menos), que es el lado
 * seguro para "existe la primitiva".
 */
export function topLevelDecls(src: string): TopLevelDecl[] {
  const marks: { name: string; verb: string | null; start: number }[] = []

  const patrones: RegExp[] = [
    /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*[(<]/gm,
    /^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|function\b|cache\()/gm,
  ]

  for (const re of patrones) {
    for (const m of src.matchAll(re)) {
      const name = m[1]
      const exportado = m[0].trimStart().startsWith('export')
      marks.push({
        name,
        verb: exportado && VERBOS.test(name) ? name : null,
        start: m.index ?? 0,
      })
    }
  }

  marks.sort((a, b) => a.start - b.start)

  return marks.map((mark, i) => ({
    name: mark.name,
    verb: mark.verb,
    start: mark.start,
    body: src.slice(mark.start, marks[i + 1]?.start ?? src.length),
  }))
}

/**
 * Cuerpo de un handler EXPANDIDO con los helpers locales que llama.
 *
 * La expansion es transitiva (un helper puede apoyarse en otro) con tope de
 * profundidad, y nunca reentra en el propio handler ni en un helper ya incluido.
 */
export function expandirConHelpers(
  handler: TopLevelDecl,
  decls: TopLevelDecl[],
  maxDepth = 3
): string {
  const incluidos = new Set<string>([handler.name])
  let texto = handler.body

  for (let depth = 0; depth < maxDepth; depth++) {
    let crecio = false
    for (const d of decls) {
      if (incluidos.has(d.name)) continue
      if (d.verb !== null) continue // otro handler no es un helper
      // Llamada por nombre: `loadAndGate(` o `await resolve(`.
      if (!new RegExp(`\\b${d.name}\\s*\\(`).test(texto)) continue
      incluidos.add(d.name)
      texto += '\n' + d.body
      crecio = true
    }
    if (!crecio) break
  }

  return texto
}

export interface HandlerAnalizado {
  verb: string
  /** Solo el bloque del handler, como lo cortaban los tripwires antes. */
  bloque: string
  /** El bloque mas los helpers locales que llama. Esto es lo que hay que mirar. */
  alcance: string
  /** Nombres de los helpers locales que se sumaron al alcance. */
  helpers: string[]
}

/** Devuelve los handlers MUTANTES de un archivo de ruta, con su alcance real. */
export function handlersMutantes(src: string): HandlerAnalizado[] {
  return handlersDe(src, (verb) => VERBOS_MUTANTES.test(verb))
}

/** Devuelve TODOS los handlers exportados (incluido GET), con su alcance real. */
export function handlersTodos(src: string): HandlerAnalizado[] {
  return handlersDe(src, () => true)
}

/**
 * ¿El parametro de ruta `params.<nombre>` pasa por `primitiva(...)` en este archivo,
 * ya sea directo o a traves de un helper local al que se le entrega?
 *
 *   isUuid(params.imageId)                          -> directo
 *   resolve(request, params.imageId)                -> por helper, si dentro de
 *   async function resolve(request, imageId) {         `resolve` se valida el
 *     if (!isUuid(imageId)) ...                        parametro que le toco
 *
 * La correspondencia es POSICIONAL: se mira en que lugar de la llamada va
 * `params.<nombre>` y se valida el parametro del helper que ocupa ese mismo
 * lugar. Sin eso, bastaria que el helper validara CUALQUIER cosa para dar el
 * visto bueno, y el tripwire empezaria a aprobar de mas.
 */
export function parametroPasaPor(src: string, nombre: string, primitiva: string): boolean {
  if (new RegExp(`${primitiva}\\(\\s*params\\.${nombre}\\b`).test(src)) return true

  const decls = topLevelDecls(src)
  for (const d of decls) {
    if (d.verb !== null) continue
    const firma = d.body.match(new RegExp(`\\b${d.name}\\s*\\(([^)]*)\\)`))
    if (!firma) continue
    const nombresParam = firma[1]
      .split(',')
      .map((p) => p.trim().replace(/[:=][\s\S]*$/, '').trim())
      .filter(Boolean)
    if (nombresParam.length === 0) continue

    // Cada llamada al helper en el archivo, buscando en que posicion va params.<nombre>.
    for (const llamada of src.matchAll(new RegExp(`\\b${d.name}\\s*\\(([^)]*)\\)`, 'g'))) {
      if (llamada.index === d.start) continue // la declaracion, no una llamada
      const args = llamada[1].split(',').map((a) => a.trim())
      const pos = args.findIndex((a) => new RegExp(`\\bparams\\.${nombre}\\b`).test(a))
      if (pos === -1) continue
      const recibe = nombresParam[pos]
      if (!recibe) continue
      if (new RegExp(`${primitiva}\\(\\s*${recibe}\\b`).test(d.body)) return true
    }
  }

  return false
}

// ── Gate de membresia verificado a traves del modulo que lo define ───────────

const TABLA_MEMBRESIA =
  /\.from\(\s*'(?:project_members|workspace_members|team_members|space_members|org_members)'\s*\)/
/** El filtro que ACOTA la consulta a una persona, no a "dame el equipo entero". */
const FILTRO_IDENTIDAD = /\.eq\(\s*'(?:profile_id|user_id)'\s*,\s*([\w.]+)\s*\)/g

/** Que nombre importado viene de que modulo. */
export function origenDeImports(src: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+'([^']+)'/g)) {
    for (const crudo of m[1].split(',')) {
      const nombre = crudo.trim().split(/\s+as\s+/).pop()?.trim()
      if (nombre) out.set(nombre, m[2])
    }
  }
  return out
}

/** Resuelve un especificador '@/lib/x' al archivo real, si existe. */
function rutaDeModulo(spec: string, raiz: string): string | null {
  if (!spec.startsWith('@/')) return null
  const base = join(raiz, 'src', spec.slice(2))
  for (const cola of ['.ts', '.tsx', '/index.ts']) {
    if (existsSync(base + cola)) return base + cola
  }
  return null
}

/** Nombres de parametro de todas las firmas que aparecen en un texto. */
function nombresDeParametros(texto: string): Set<string> {
  const out = new Set<string>()
  for (const m of texto.matchAll(/\b\w+\s*\(([^)]*)\)\s*(?::[^{;]*)?\{/g)) {
    for (const crudo of m[1].split(',')) {
      const nombre = crudo.trim().replace(/[:=][\s\S]*$/, '').trim()
      if (/^\w+$/.test(nombre)) out.add(nombre)
    }
  }
  return out
}

/**
 * ¿La funcion `nombre`, definida en `srcModulo`, consulta una tabla de membresia
 * ACOTADA a la identidad que le entregan?
 *
 * Las dos mitades importan. Nombrar `workspace_members` no basta y esa fue una
 * leccion cara: una ruta la leia como carga util ("dame el equipo entero de este
 * workspace") y el tripwire la daba por buena mientras debajo habia un IDOR real.
 * Por eso se exige ademas el filtro por identidad, y que el valor de ese filtro
 * sea un PARAMETRO de la funcion (o la sesion que ella misma resuelve), nunca un
 * id que venga del recurso que se esta leyendo.
 */
function funcionAcotaPorIdentidad(srcModulo: string, nombre: string): boolean {
  const decls = topLevelDecls(srcModulo)
  const objetivo = decls.find((d) => d.name === nombre)
  if (!objetivo) return false

  const texto = expandirConHelpers(objetivo, decls)
  if (!TABLA_MEMBRESIA.test(texto)) return false

  const params = nombresDeParametros(texto)
  const resuelveSesion = /getUser\(|getCachedUser\(/.test(texto)
  for (const m of texto.matchAll(FILTRO_IDENTIDAD)) {
    const base = m[1].split('.')[0]
    if (params.has(base)) return true
    if (resuelveSesion && /^(user|session|profile)$/.test(base)) return true
  }
  return false
}

const cacheModulos = new Map<string, string>()
function leerModulo(ruta: string): string {
  if (!cacheModulos.has(ruta)) cacheModulos.set(ruta, readFileSync(ruta, 'utf8'))
  return cacheModulos.get(ruta) as string
}

/**
 * ¿La primitiva `re` es ALCANZABLE desde `texto`? Directa, o dentro de una funcion
 * que `texto` llama, este esa funcion en el mismo archivo o en un modulo del repo.
 *
 * Es la version generica del mismo problema de siempre: la barrera correcta suele
 * estar factorizada. `safeFileName(file.name)` sanea igual de bien que escribir el
 * `.replace(/[^\w.\-]+/g, '_')` a mano, y de hecho mejor, porque hay UN sitio donde
 * arreglarlo. Un tripwire que solo reconoce la forma literal castiga justo la
 * version buena del codigo, y a base de castigarla se vuelve ruido.
 */
export function primitivaAlcanzable(
  src: string,
  raiz: string,
  texto: string,
  re: RegExp
): boolean {
  if (re.test(texto)) return true

  const imports = origenDeImports(src)
  const decls = topLevelDecls(src)
  const vistos = new Set<string>()

  for (const m of texto.matchAll(/\b(\w+)\s*\(/g)) {
    const nombre = m[1]
    if (vistos.has(nombre)) continue
    vistos.add(nombre)

    const local = decls.find((d) => d.name === nombre && d.verb === null)
    if (local && re.test(expandirConHelpers(local, decls))) return true

    const spec = imports.get(nombre)
    if (!spec) continue
    const ruta = rutaDeModulo(spec, raiz)
    if (!ruta) continue
    const mdecls = topLevelDecls(leerModulo(ruta))
    const objetivo = mdecls.find((d) => d.name === nombre)
    if (objetivo && re.test(expandirConHelpers(objetivo, mdecls))) return true
  }

  return false
}

/** Un gate encontrado y comprobado, para poder decir POR QUE se dio por bueno. */
export interface GateVerificado {
  helper: string
  modulo: string
}

/**
 * Gates de membresia que este archivo de ruta usa DE VERDAD: llama a un helper
 * pasandole la identidad de la sesion (`user.id`), y ese helper, en el modulo que
 * lo define, consulta la membresia acotada a esa identidad.
 *
 * Es una comprobacion de dos lados. Un solo lado siempre se puede fingir: pasar
 * `user.id` a algo que lo ignora, o filtrar por membresia con un id que sale del
 * propio recurso. Los dos a la vez, no.
 */
export function gateDeMembresiaVerificado(
  src: string,
  raiz: string,
  /** Donde buscar las llamadas. Por defecto el archivo entero; los tripwires que
   *  razonan por handler pasan aqui el ALCANCE de ese handler, para que el gate de
   *  un hermano no tape el hueco de este. */
  texto: string = src
): GateVerificado[] {
  const imports = origenDeImports(src)
  const localSrc = new Map<string, string>()
  const out: GateVerificado[] = []
  const vistos = new Set<string>()

  // Se mira CADA "identificador(" del archivo y se lee su lista de argumentos hasta
  // el primer parentesis de cierre. No se busca la llamada completa de una pieza a
  // proposito: la forma real en el repo es `if (!(await canAccessProject(a, b,
  // user.id)))`, y un patron de una pieza se traga el `if (` de fuera y nunca llega
  // al helper de dentro. Asi cada nivel del anidamiento tiene su turno; los que no
  // son helpers (`if`, `await`) se caen solos al no superar la comprobacion.
  for (const m of texto.matchAll(/\b(\w+)\s*\(/g)) {
    const nombre = m[1]
    if (vistos.has(nombre)) continue
    const desde = (m.index ?? 0) + m[0].length
    const cierre = texto.indexOf(')', desde)
    if (cierre === -1) continue
    if (!/\buser\.id\b/.test(texto.slice(desde, cierre))) continue
    vistos.add(nombre)

    const spec = imports.get(nombre)
    let modulo = spec ?? '(mismo archivo)'
    let fuente: string | null = null

    if (spec) {
      const ruta = rutaDeModulo(spec, raiz)
      if (!ruta) continue
      if (!localSrc.has(ruta)) localSrc.set(ruta, readFileSync(ruta, 'utf8'))
      fuente = localSrc.get(ruta) ?? null
    } else {
      fuente = src
      modulo = '(mismo archivo)'
    }

    if (fuente && funcionAcotaPorIdentidad(fuente, nombre)) out.push({ helper: nombre, modulo })
  }

  return out
}

function handlersDe(src: string, filtro: (verb: string) => boolean): HandlerAnalizado[] {
  const decls = topLevelDecls(src)
  const out: HandlerAnalizado[] = []
  for (const d of decls) {
    if (d.verb === null || !filtro(d.verb)) continue
    const alcance = expandirConHelpers(d, decls)
    const helpers = decls
      .filter((h) => h.verb === null && alcance.includes(h.body) && h.name !== d.name)
      .map((h) => h.name)
    out.push({ verb: d.verb, bloque: d.body, alcance, helpers })
  }
  return out
}

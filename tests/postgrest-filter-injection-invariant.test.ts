/**
 * Tripwire de INYECCION DE FILTRO POSTGREST (PostgREST filter injection).
 *
 * El operador `.or(...)` de supabase-js recibe un STRING con la mini gramatica de
 * filtros de PostgREST (`col.eq.valor,col2.is.null`). Ese string NO es una consulta
 * parametrizada: si se concatena un valor CRUDO del request dentro del `.or()`, un
 * atacante mete comas, puntos y operadores para REESCRIBIR el filtro. Ejemplo: un
 * `.or(\`name.eq.${q}\`)` con q = "x,visibility.eq.private" amplia el OR y expone
 * filas privadas. La misma trampa aplica al NOMBRE de una funcion `.rpc()`: si el
 * nombre se arma con un template, se puede invocar otra funcion.
 *
 * La postura correcta, que HOY cumple toda la superficie: dentro de un filtro solo
 * se interpola un valor de CONFIANZA (el id de la sesion `user.id`, una marca de
 * tiempo del server `nowIso`, o un `params.projectId` que el handler YA valido como
 * UUID, de modo que no puede contener metacaracteres del filtro), y todo `.rpc()`
 * usa un nombre de funcion ESTATICO con argumentos por nombre (parametrizados).
 *
 * ── POR QUE ESTE TEST SE REESCRIBIO (2 puntos ciegos, 0 huecos) ──────────────
 * Nacio mirando SOLO `route.ts` bajo `src/app/api`, y SOLO la linea del `.or(`
 * buscando un `${` literal. Con el tiempo se quedo corto por los dos lados:
 *
 *   1) EL SITIO. Los filtros tambien se arman en server components (`page.tsx`,
 *      que corren en el server y usan el admin client igual que un handler) y en
 *      `src/lib`. El scan no los veia. El contador de sitios BAJO de 6 a 3 y el
 *      test se puso rojo, pero no porque el codigo se hubiera vuelto mas seguro:
 *      porque la superficie se mudo a donde el escaner no miraba. Un rojo que
 *      significa "se me escapo la mitad del mapa" es exactamente el ruido que
 *      hace que un rojo de verdad pase desapercibido.
 *
 *   2) LA FORMA. `src/lib/note-visibility.ts` exporta `noteVisibilityPrefilter`,
 *      una funcion que DEVUELVE la cadena de filtro con el id interpolado dentro.
 *      Su call site es `.or(noteVisibilityPrefilter(user.id))`: no tiene un solo
 *      `${`, asi que el patron viejo lo daba por limpio sin mirarlo. Un
 *      constructor de filtros es el mismo vector con un paso de indireccion.
 *
 * Contrato, cuatro aristas, sobre TODO `.ts`/`.tsx` de `src`:
 *   A) Toda expresion `${...}` interpolada en la linea de un `.or(` pertenece al
 *      allowlist de expresiones de confianza.
 *   B) Todo CONSTRUCTOR de filtros (funcion que devuelve un template con forma de
 *      filtro PostgREST e interpola algo) se comprueba por los DOS lados: dentro,
 *      solo interpola sus PROPIOS PARAMETROS (no una global ni input capturado);
 *      fuera, cada call site le pasa una expresion de confianza. Un solo lado es
 *      falsificable; los dos a la vez, no.
 *   C) El unico handler que interpola un `params.*` en un `.or()` (task-templates)
 *      valida ese parametro con isUuid antes de usarlo.
 *   D) Ningun `.rpc()` arma su nombre de funcion con un template literal (backtick).
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 *
 * Hoy 5 sitios `.or(` interpolan solo {user.id, nowIso, params.projectId}, 1
 * constructor de filtros recibe solo `user.id` en sus 4 call sites, y 0 rpc con
 * nombre dinamico. Un filtro nuevo con input crudo cae aqui. Nunca un silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { topLevelDecls, primitivaAlcanzable } from './helpers/routeSource'

const RAIZ = process.cwd()
const SRC = join(RAIZ, 'src')

// Toda la superficie de server: rutas, server components y helpers de src/lib.
function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkSources(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (f: string) => '/src' + f.replace(SRC, '').replace(/\\/g, '/')

// Expresiones de confianza que pueden interpolarse dentro de un filtro:
//   - user.id : UUID de la sesion autenticada
//   - nowIso  : timestamp ISO generado en el server
//   - params.projectId : validado con isUuid en su handler (arista C lo cubre)
const SAFE_INTERP = new Set(['user.id', 'nowIso', 'params.projectId'])

// Un template literal con forma de filtro PostgREST (`col.op.valor`) que ademas
// interpola algo. Es la forma que hay que auditar, este donde este.
const FILTRO_TPL = /`[^`]*\b\w+\.(?:eq|neq|gt|gte|lt|lte|like|ilike|is|in|cs|cd|fts)\.[^`]*\$\{[^`]*`/

function interpolaciones(texto: string): string[] {
  return [...texto.matchAll(/\$\{([^}]*)\}/g)].map((m) => m[1].trim())
}

describe('Invariante: ningun filtro PostgREST (.or / .rpc) se arma con input crudo', () => {
  const files = walkSources(SRC).filter((f) => !/[\\/]tests?[\\/]/.test(f))
  const fuentes = new Map<string, string>(files.map((f) => [f, readFileSync(f, 'utf8')]))

  const interpViolations: string[] = []
  const rpcDynamic: string[] = []
  let orInterpSites = 0

  // Arista A + D: escaneo por linea sobre toda la superficie.
  for (const [file, src] of fuentes) {
    src.split('\n').forEach((line, i) => {
      if (/\.or\(/.test(line) && line.includes('${')) {
        for (const expr of interpolaciones(line)) {
          orInterpSites++
          if (!SAFE_INTERP.has(expr)) {
            interpViolations.push(`${rel(file)}:${i + 1} -> \${${expr}}`)
          }
        }
      }
      if (/\.rpc\(\s*`/.test(line)) rpcDynamic.push(`${rel(file)}:${i + 1}`)
    })
  }

  // Arista B: constructores de filtros, comprobados por los dos lados.
  const constructores: { nombre: string; file: string }[] = []
  const fugaInterna: string[] = []
  const argsSospechosos: string[] = []

  for (const [file, src] of fuentes) {
    for (const d of topLevelDecls(src)) {
      if (d.verb !== null) continue
      if (!FILTRO_TPL.test(d.body)) continue
      constructores.push({ nombre: d.name, file })

      // Lado de DENTRO: lo interpolado tiene que ser un parametro propio. Si sale
      // de otro lado (una global, algo capturado del request), el constructor
      // podria estar metiendo input crudo sin que el call site se entere.
      const firma = d.body.match(new RegExp(`\\b${d.name}\\s*\\(([^)]*)\\)`))
      const params = new Set(
        (firma?.[1] ?? '')
          .split(',')
          .map((p) => p.trim().replace(/[:=][\s\S]*$/, '').trim())
          .filter(Boolean)
      )
      const tpl = d.body.match(new RegExp(FILTRO_TPL.source))?.[0] ?? ''
      for (const expr of interpolaciones(tpl)) {
        if (!params.has(expr.split('.')[0])) {
          fugaInterna.push(`${rel(file)} :: ${d.name} -> \${${expr}}`)
        }
      }
    }
  }

  /**
   * PROVENIENCIA DEL ARGUMENTO. La pregunta no es como se llama la variable que
   * entra al constructor, es DE DONDE SALIO. Dos de los cuatro call sites pasan
   * un `userId` que no esta en el allowlist, y la tentacion barata es agregar
   * "userId" a la lista: eso aprueba por el nombre, y el dia que alguien escriba
   * `const userId = body.userId` el tripwire aplaude una inyeccion.
   *
   * Asi que se persigue. Tres formas de que una expresion sea identidad real:
   *   1. Esta en el allowlist (`user.id`): la sesion, sin intermediarios.
   *   2. Se asigno en su archivo desde algo que RESUELVE la sesion, directo o
   *      encadenado (`const res = await resolveTeamForViewer(...)`, y luego
   *      `const { userId } = res.ctx`).
   *   3. Es un PARAMETRO de la funcion que la envuelve: entonces la identidad no
   *      se capturo aqui, se recibio, y la pregunta se muda al llamador. Se sigue
   *      hasta la punta, donde tiene que aparecer la sesion.
   * Si ninguna se cumple, es sospechosa y sale en la lista.
   */
  const SESION = /getUser\(|getCachedUser\(/

  function declQueEnvuelve(src: string, idx: number) {
    let elegida: { name: string; body: string; start: number } | null = null
    for (const d of topLevelDecls(src)) {
      if (d.start <= idx && (!elegida || d.start > elegida.start)) elegida = d
    }
    return elegida
  }

  function paramsDe(body: string, nombre: string): string[] {
    const firma = body.match(new RegExp(`\\b${nombre}\\s*\\(([^)]*)\\)`))
    return (firma?.[1] ?? '')
      .split(',')
      .map((p) => p.trim().replace(/[:=][\s\S]*$/, '').trim())
      .filter(Boolean)
  }

  function saleDeLaSesion(file: string, expr: string, prof = 0): boolean {
    if (SAFE_INTERP.has(expr)) return true
    if (prof > 3) return false
    const src = fuentes.get(file)
    if (!src) return false
    const base = expr.split('.')[0]

    // Forma 2: asignada en este archivo desde algo que resuelve la sesion.
    const asign = src.match(
      new RegExp(`(?:const|let)\\s+(?:\\{[^}]*\\b${base}\\b[^}]*\\}|${base})\\s*=\\s*(?:await\\s+)?([\\w.]+)`)
    )
    if (asign) {
      const origen = asign[1].split('.')[0]
      if (primitivaAlcanzable(src, RAIZ, `${origen}(`, SESION)) return true
      if (origen !== base && saleDeLaSesion(file, origen, prof + 1)) return true
    }

    // Forma 3: es parametro de la funcion que la envuelve. Se sube al llamador y
    // se mira QUE le pasan en esa posicion.
    const usos = [...src.matchAll(new RegExp(`\\b${base}\\b`, 'g'))]
    for (const uso of usos) {
      const envolvente = declQueEnvuelve(src, uso.index ?? 0)
      if (!envolvente) continue
      const params = paramsDe(envolvente.body, envolvente.name)
      const pos = params.indexOf(base)
      if (pos === -1) continue
      for (const [otroFile, otroSrc] of fuentes) {
        for (const llamada of otroSrc.matchAll(
          new RegExp(`\\b${envolvente.name}\\s*\\(([^)]*)\\)`, 'g')
        )) {
          if (otroFile === file && (llamada.index ?? 0) === envolvente.start) continue
          const args = llamada[1].split(',').map((a) => a.trim()).filter(Boolean)
          if (args.length <= pos) continue
          if (saleDeLaSesion(otroFile, args[pos], prof + 1)) return true
        }
      }
    }
    return false
  }

  // Lado de FUERA: cada call site le pasa una identidad con proveniencia de sesion.
  let callSites = 0
  for (const { nombre } of constructores) {
    for (const [file, src] of fuentes) {
      for (const m of src.matchAll(new RegExp(`\\b${nombre}\\s*\\(([^)]*)\\)`, 'g'))) {
        // La declaracion no es una llamada.
        if (/(?:function|const|let)\s+$/.test(src.slice(Math.max(0, (m.index ?? 0) - 20), m.index))) continue
        const args = m[1].split(',').map((a) => a.trim()).filter(Boolean)
        if (args.length === 0) continue
        callSites++
        for (const arg of args) {
          if (!saleDeLaSesion(file, arg)) {
            argsSospechosos.push(`${rel(file)} -> ${nombre}(${arg})`)
          }
        }
      }
    }
  }

  it('el scan encuentra los filtros .or interpolados (no esta vacio)', () => {
    expect(orInterpSites).toBeGreaterThanOrEqual(5)
  })

  it('el scan cubre toda la superficie de server, no solo las rutas api', () => {
    // El punto ciego que hizo rojo a este test: la mitad de los filtros vivian en
    // server components y en src/lib. Si el walker vuelve a encerrarse en
    // /app/api, este numero se desploma y se ve.
    expect(files.length).toBeGreaterThanOrEqual(200)
    expect(files.some((f) => /page\.tsx$/.test(f))).toBe(true)
    expect(files.some((f) => /[\\/]lib[\\/]/.test(f))).toBe(true)
  })

  it('toda interpolacion dentro de un .or() es una expresion de confianza', () => {
    expect(interpViolations.sort()).toEqual([])
  })

  it('el scan encuentra los constructores de filtros y sus call sites', () => {
    expect(constructores.length).toBeGreaterThanOrEqual(1)
    expect(callSites).toBeGreaterThanOrEqual(3)
  })

  it('todo constructor de filtros interpola solo sus propios parametros', () => {
    expect(fugaInterna.sort()).toEqual([])
  })

  it('todo call site de un constructor de filtros pasa una expresion de confianza', () => {
    expect(argsSospechosos.sort()).toEqual([])
  })

  it('el unico handler que interpola un params.* en .or() valida con isUuid', () => {
    const src = readFileSync(
      join(SRC, 'app', 'api', 'projects', '[projectId]', 'task-templates', 'route.ts'),
      'utf8'
    )
    expect(src).toMatch(/isUuid\(params\.projectId\)/)
  })

  it('ningun .rpc() arma su nombre de funcion con un template literal', () => {
    expect(rpcDynamic.sort()).toEqual([])
  })
})

/**
 * Tripwire de ERROR TRAGADO EN LA BARRERA DE ACCESO: "no tienes acceso" y "no
 * pude averiguarlo" no son la misma respuesta y no pueden salir por la misma
 * puerta.
 *
 * El caso: `canAccessProject` (src/lib/team-access.ts) resuelve el acceso con
 * hasta cuatro lecturas a la base. Si una FALLA, `data` viene null, y un helper
 * ingenuo lo lee como "este usuario no es miembro" y devuelve `ok: false`. La
 * ruta responde 403 "Sin acceso". El usuario ve un mensaje perfectamente
 * plausible que le dice que le quitaron permisos que en realidad tiene, abre un
 * ticket de permisos, y la causa real (la base no responde) no aparece en ningun
 * lado porque el unico rastro fue un console.error entre miles de lineas.
 *
 * Es EXACTAMENTE la forma de fallo que mantuvo vivo seis semanas el bug de rate
 * limit: un error tragado que se disfraza de respuesta normal. La diferencia es
 * que aqui se disfraza de una respuesta que ademas culpa al usuario.
 *
 * Por eso `canAccessProject` devuelve un tercer campo, `failed`, y por eso este
 * archivo existe: el arreglo dura lo que dure la disciplina de leerlo, y el call
 * site numero 12 nace ciego si nadie lo vigila.
 *
 * Contrato, cuatro aristas:
 *   A) PRODUCTOR: `canAccessProject` captura el `error` de TODAS sus lecturas
 *      (un `data`-solo es un error tragado) y expone `failed`.
 *   B) CONSUMIDORES: todo call site de `canAccessProject` desestructura `failed`
 *      y RAMIFICA sobre el (un `if`), no solo lo nombra.
 *   C) ANTI-SOMBREADO: ningun archivo redefine localmente el nombre de un helper
 *      de autorizacion exportado por lib. Tres rutas tenian su propia
 *      `canAccessProject` con una regla DISTINTA (aceptaba a cualquier miembro
 *      del workspace, no solo owner/admin). Dos reglas bajo un nombre es peor
 *      que dos reglas: quien lee cree ver la barrera auditada, y cualquier
 *      busqueda por el nombre encuentra la copia y la da por buena.
 *   D) ANTI-VACUIDAD: el scan encuentra superficie de verdad. Un walker que deja
 *      de ver archivos pasa todo en verde y eso se lee como "seguro" cuando
 *      significa "me quede sin mapa".
 *
 * Determinista: solo lee fuentes, no monta rutas ni DB.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(process.cwd(), 'src')
const TEAM_ACCESS = join(SRC, 'lib', 'team-access.ts')

function walkSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkSources(full, out)
    else if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

const rel = (f: string) => f.replace(SRC, '').replace(/\\/g, '/')

const files = walkSources(SRC)
const fuentes = new Map(files.map((f) => [f, readFileSync(f, 'utf8')]))

/**
 * Los helpers de autorizacion que exporta lib. Se DESCUBREN leyendo el modulo,
 * no se listan a mano: una lista fija se queda corta con el primer helper nuevo
 * y el tripwire se vuelve decorativo sin avisar.
 */
function helpersExportados(file: string): string[] {
  const src = fuentes.get(file) ?? ''
  return [...src.matchAll(/export\s+async\s+function\s+(\w+)/g)].map((m) => m[1])
}

describe('Invariante: la barrera de acceso distingue "no tienes" de "no pude averiguarlo"', () => {
  // Arista D: el scan ve superficie real.
  it('el scan cubre la superficie de src (no esta vacio)', () => {
    expect(files.length).toBeGreaterThanOrEqual(200)
    expect(fuentes.get(TEAM_ACCESS)).toBeTruthy()
  })

  // Arista A: el productor no traga errores.
  it('canAccessProject captura el error de todas sus lecturas y expone failed', () => {
    const src = fuentes.get(TEAM_ACCESS) ?? ''
    const cuerpo = src.slice(src.indexOf('export async function canAccessProject'))
    const fin = cuerpo.indexOf('\nexport ', 1)
    const fn = fin === -1 ? cuerpo : cuerpo.slice(0, fin)

    expect(fn).toMatch(/failed:\s*boolean/)

    // Toda desestructuracion de una lectura trae `error:`. Un `const { data: x } =`
    // pelado es la firma exacta del error tragado.
    const lecturas = [...fn.matchAll(/const\s*\{\s*data:[^}]*\}\s*=/g)].map((m) => m[0])
    expect(lecturas.length).toBeGreaterThanOrEqual(4)
    const tragadas = lecturas.filter((l) => !/error\s*:/.test(l))
    expect(tragadas).toEqual([])
  })

  // Arista B: los consumidores ramifican sobre failed.
  it('todo call site de canAccessProject desestructura failed y ramifica sobre el', () => {
    const infractores: string[] = []
    let sitios = 0

    for (const [file, src] of fuentes) {
      if (file === TEAM_ACCESS) continue
      for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*await\s+canAccessProject\s*\(/g)) {
        sitios++
        const destructurado = m[1]
        // `failed` o `failed: alias`.
        const campo = destructurado.match(/\bfailed\b\s*(?::\s*(\w+))?/)
        if (!campo) {
          infractores.push(`${rel(file)}: no desestructura failed`)
          continue
        }
        const alias = campo[1] ?? 'failed'
        // Nombrarlo no basta: tiene que existir la rama que lo separa del !ok.
        const ventana = src.slice(m.index ?? 0, (m.index ?? 0) + 500)
        if (!new RegExp(`if\\s*\\(\\s*${alias}\\s*\\)`).test(ventana)) {
          infractores.push(`${rel(file)}: desestructura ${alias} pero no ramifica sobre el`)
        }
      }
    }

    expect(infractores.sort()).toEqual([])
    // Anti-vacuidad del propio test: si el regex deja de encontrar call sites,
    // la lista de infractores queda vacia y esto pasaria por buenas razones
    // equivocadas.
    expect(sitios).toBeGreaterThanOrEqual(10)
  })

  // Arista C: nadie redefine localmente un helper de autorizacion de lib.
  it('ningun archivo sombrea el nombre de un helper de autorizacion de lib', () => {
    const helpers = helpersExportados(TEAM_ACCESS)
    expect(helpers).toContain('canAccessProject')

    const sombras: string[] = []
    for (const [file, src] of fuentes) {
      if (file === TEAM_ACCESS) continue
      for (const nombre of helpers) {
        if (new RegExp(`(?:async\\s+)?function\\s+${nombre}\\s*\\(`).test(src)) {
          sombras.push(`${rel(file)}: redefine ${nombre}`)
        }
      }
    }
    expect(sombras.sort()).toEqual([])
  })

  /**
   * Las tres copias locales que se renombraron heredaron el mismo defecto del
   * original (descartar el `error` de sus lecturas). Se quedan vigiladas por su
   * nombre nuevo: son barreras de acceso reales aunque no sean LA barrera.
   */
  it('las barreras locales de proyecto/workspace tampoco tragan el error', () => {
    const infractores: string[] = []
    for (const [file, src] of fuentes) {
      const def = src.indexOf('function isProjectOrWorkspaceMember')
      if (def === -1) continue
      const fn = src.slice(def, def + 2200)
      if (!/failed/.test(fn)) infractores.push(`${rel(file)}: no expone failed`)
      const lecturas = [...fn.matchAll(/const\s*\{\s*data:[^}]*\}\s*=/g)].map((m) => m[0])
      if (lecturas.some((l) => !/error\s*:/.test(l))) {
        infractores.push(`${rel(file)}: descarta el error de alguna lectura`)
      }
    }
    expect(infractores.sort()).toEqual([])
  })
})

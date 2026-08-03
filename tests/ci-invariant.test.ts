/**
 * Tripwire del CI y del corredor de pruebas.
 *
 * Quien cuida al que cuida. Todo el repo esta cubierto por tripwires, y desde hoy
 * esos tripwires corren solos en GitHub Actions. Pero el CI mismo no estaba
 * cubierto por nada: borrar `.github/workflows/ci.yml`, o cambiar `npm test` por
 * `npm test || true`, o meter un `continue-on-error: true`, dejaba el repo
 * exactamente como estaba antes (sin red) y con la apariencia de tenerla. Verde
 * en cada commit, sin ejecutar una sola prueba.
 *
 * Ese es el mismo fallo que se persigue en todo el proyecto: el error de la tasa
 * sobrevivio seis semanas porque su unica senal era una linea de log entre miles.
 * Un CT desarmado es peor todavia, porque no emite ni esa linea.
 *
 * Tres capas:
 *
 *   1. EL WORKFLOW sigue armado: corre en toda rama y en todo PR, instala con
 *      `npm ci`, y ejecuta tipos, tripwires y build sin valvulas de escape.
 *   2. EL CORREDOR sigue recogiendo todo: vitest no excluye carpetas, no quedan
 *      pruebas apagadas con `.skip`, y ningun `.only` silencia al resto.
 *   3. EL CI NO DEPENDE DE SECRETOS. En el momento en que necesite credenciales
 *      reales deja de ser determinista, empieza a fallar por razones que nadie
 *      puede arreglar desde un PR, y se vuelve ruido que todos aprenden a
 *      ignorar. Que es como se pierde una red de seguridad sin borrarla.
 *
 * Determinista: lee archivos de disco. No toca red ni DB.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const WORKFLOW = join(RAIZ, '.github', 'workflows', 'ci.yml')
const VITEST = join(RAIZ, 'vitest.config.ts')
const TESTS = join(RAIZ, 'tests')

// ─────────────────────────────────────────────────────────────────────────────
// 1. El workflow sigue armado
// ─────────────────────────────────────────────────────────────────────────────

describe('CI: el workflow existe y no esta desarmado', () => {
  it('el archivo del workflow sigue ahi', () => {
    expect(
      existsSync(WORKFLOW),
      'desaparecio .github/workflows/ci.yml. Sin el, los cientos de tripwires del repo vuelven a ser documentacion: solo corren si alguien se acuerda.',
    ).toBe(true)
  })

  /**
   * Clave = que garantiza, en una linea. Valor = como se reconoce.
   *
   * CADA PATRON ANCLA EN EL COMANDO COMPLETO, NO EN LA PALABRA. Buscar solo
   * `/npm test/` seria un tripwire decorativo: `npm test || true` tambien lo
   * contiene, y ese es justo el sabotaje mas probable, porque es el que deja
   * todo en verde. Por eso el patron exige el final de linea limpio.
   */
  const GARANTIAS: Record<string, RegExp> = {
    'corre en toda rama, no solo en master': /branches:\s*\['\*\*'\]/,
    'corre tambien en los PR hacia master': /pull_request:[\s\S]{0,80}branches:\s*\[master\]/,
    'instala con npm ci (exacto al lock), no con npm install':
      /run:\s*npm ci\s*$/m,
    'corre el chequeo de tipos': /run:\s*npm run type-check\s*$/m,
    'corre los tripwires': /run:\s*npm test\s*$/m,
    'corre el build': /run:\s*npm run build\s*$/m,
    'el job tiene tope de tiempo y no se cuelga para siempre':
      /timeout-minutes:\s*\d+/,
  }

  it('el workflow conserva todas sus garantias', () => {
    const src = readFileSync(WORKFLOW, 'utf8')
    // Se juntan TODAS las que faltan y se falla una sola vez con la lista
    // completa. Si una reescritura se lleva cuatro garantias por delante, el
    // rojo tiene que nombrar las cuatro a la primera.
    const faltantes = Object.entries(GARANTIAS)
      .filter(([, patron]) => !patron.test(src))
      .map(([porque]) => porque)

    expect(faltantes, 'el CI perdio garantias:').toEqual([])
  })

  /**
   * Las valvulas de escape. Todas hacen lo mismo: dejan el check en verde
   * mientras el paso de abajo falla. Ninguna tiene un uso legitimo en este
   * workflow, asi que la presencia de cualquiera es el hallazgo.
   */
  const VALVULAS: { patron: RegExp; porque: string }[] = [
    {
      patron: /continue-on-error:\s*true/,
      porque: 'un paso marcado continue-on-error falla en silencio y el check queda verde',
    },
    {
      patron: /\|\|\s*true/,
      porque: '`|| true` convierte cualquier comando rojo en verde',
    },
    {
      patron: /\|\|\s*exit\s+0/,
      porque: '`|| exit 0` convierte cualquier comando rojo en verde',
    },
    {
      patron: /--passWithNoTests/,
      porque:
        'con --passWithNoTests, una config rota que no encuentra ni un archivo pasa como exito',
    },
    {
      patron: /if:\s*false/,
      porque: 'un paso con `if: false` no se ejecuta nunca',
    },
  ]

  for (const { patron, porque } of VALVULAS) {
    it(`no tiene valvula de escape: ${porque}`, () => {
      const src = readFileSync(WORKFLOW, 'utf8')
      expect(patron.test(src), `el CI trae una valvula de escape. ${porque}`).toBe(false)
    })
  }

  it('no depende de secretos', () => {
    // No es higiene, es diseno. Un CI que necesita credenciales reales deja de
    // ser determinista: empieza a ponerse rojo por llaves vencidas o cuotas
    // agotadas, cosas que quien manda el PR no puede arreglar. Un check que
    // falla por razones ajenas se aprende a ignorar, y un check ignorado no
    // protege nada. Si algun dia el build necesita llaves de verdad, el
    // problema a arreglar es la dependencia, no la falta de llaves.
    const src = readFileSync(WORKFLOW, 'utf8')
    expect(
      /\$\{\{\s*secrets\./.test(src),
      'el CI empezo a depender de secretos y con eso dejo de ser determinista',
    ).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. El corredor sigue recogiendo todo
// ─────────────────────────────────────────────────────────────────────────────

/** Todos los archivos `*.test.ts` bajo `tests/`, recursivo. */
function archivosDePrueba(dir: string): string[] {
  const salida: string[] = []
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name)
    if (entrada.isDirectory()) salida.push(...archivosDePrueba(ruta))
    else if (entrada.name.endsWith('.test.ts')) salida.push(ruta)
  }
  return salida
}

/**
 * Piso, no conteo exacto. Agregar tripwires nunca debe poner rojo este archivo;
 * quitarlos si. Bajar este numero tiene que ser una decision consciente y
 * visible en el diff, no un efecto secundario de borrar archivos.
 */
const PISO_DE_ARCHIVOS = 79

describe('CI: el corredor de pruebas recoge todo', () => {
  it('vitest sigue apuntando a toda la carpeta tests/', () => {
    const src = readFileSync(VITEST, 'utf8')
    expect(
      /include:\s*\['tests\/\*\*\/\*\.test\.ts'\]/.test(src),
      'cambio el patron de inclusion de vitest: puede haber tripwires que ya no se ejecutan',
    ).toBe(true)
  })

  it('vitest no excluye nada', () => {
    // Un `exclude` es la forma mas silenciosa de apagar un tripwire incomodo:
    // el archivo sigue en el repo, se sigue leyendo en las revisiones, y no
    // corre. Queda la calma sin el control.
    const src = readFileSync(VITEST, 'utf8')
    expect(
      /^\s*exclude:/m.test(src),
      'aparecio un `exclude` en vitest.config.ts: hay tripwires que dejaron de correr',
    ).toBe(false)
  })

  it('no se perdieron archivos de prueba', () => {
    const total = archivosDePrueba(TESTS).length
    expect(
      total,
      `la carpeta tests/ bajo de ${PISO_DE_ARCHIVOS} a ${total} archivos. Si fue a proposito, bajar el piso en el mismo commit y explicar por que.`,
    ).toBeGreaterThanOrEqual(PISO_DE_ARCHIVOS)
  })

  it('ningun tripwire quedo apagado con .skip o .todo', () => {
    // Apagar una prueba y dejarla apagada es la version lenta de borrarla, con
    // el agravante de que el archivo sigue ahi dando la impresion de cubrir algo.
    const ofensores: string[] = []
    for (const archivo of archivosDePrueba(TESTS)) {
      const src = readFileSync(archivo, 'utf8')
      for (const [i, linea] of src.split('\n').entries()) {
        if (/\b(describe|it|test)\.(skip|todo)\s*\(/.test(linea)) {
          ofensores.push(`${archivo.slice(RAIZ.length + 1)}:${i + 1}`)
        }
      }
    }
    expect(ofensores, 'hay tripwires apagados:').toEqual([])
  })

  it('ningun .only silencia al resto de la suite', () => {
    // El peor de los tres, porque no apaga una prueba: apaga TODAS las demas.
    // Un `describe.only` olvidado en un commit deja el archivo entero corriendo
    // un solo caso, en verde, para siempre.
    const ofensores: string[] = []
    for (const archivo of archivosDePrueba(TESTS)) {
      const src = readFileSync(archivo, 'utf8')
      for (const [i, linea] of src.split('\n').entries()) {
        if (/\b(describe|it|test)\.only\s*\(/.test(linea)) {
          ofensores.push(`${archivo.slice(RAIZ.length + 1)}:${i + 1}`)
        }
      }
    }
    expect(ofensores, 'hay un .only olvidado que silencia al resto:').toEqual([])
  })
})

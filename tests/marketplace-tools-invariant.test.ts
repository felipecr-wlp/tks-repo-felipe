/**
 * Tripwire del MARKETPLACE DE HERRAMIENTAS.
 *
 * El marketplace decide que pantallas existen para un workspace. Es una palanca
 * chica con radio de explosion grande, y tiene una forma concreta que hay que
 * sostener. Este tripwire fija esa forma en cuatro aristas.
 *
 * ── A) El interruptor autoriza y valida ─────────────────────────────────────
 * POST /api/workspaces/[workspaceId]/tools escribe `installed_features`, que es
 * lo que ve TODO el equipo. Debe exigir admin del workspace (no basta con estar
 * autenticado), acotar el id y pasar por rate limit.
 *
 * ── B) La clave se valida contra el CATALOGO DE CODIGO, no contra texto libre ─
 * `key` se filtra con `isInstallable`, que consulta `src/lib/features.ts`. Sin
 * ese filtro la columna acepta cualquier cadena y deja de significar algo: se
 * vuelve un basurero que ninguna pantalla sabe leer. Ademas es la razon por la
 * que instalar NO puede encender codigo arbitrario: solo puede nombrar una
 * pantalla que ya existe en el repo.
 *
 * ── C) La regla de plegado no se afloja ─────────────────────────────────────
 * `effectiveHidden()` esconde toda herramienta instalable que el workspace no
 * instalo. Si esa regla se invierte (default instalado), cada workspace del
 * sistema estrenaria de golpe pantallas que nadie pidio. Se prueba la funcion,
 * no el texto.
 *
 * ── D) NADA de sistema de archivos en src/ ──────────────────────────────────
 * La arista mas importante y la menos obvia. Un marketplace "de verdad" tienta a
 * subir un paquete, descomprimirlo en disco y cargarlo. Eso son tres agujeros de
 * una vez: escritura de rutas controladas por el paquete (zip-slip, CWE-22),
 * ejecucion de codigo que no paso por revision (RCE), y ademas ni siquiera
 * funciona en Vercel, donde el disco es de SOLO LECTURA salvo /tmp (efimero y por
 * instancia). Hoy `src/` no importa `node:fs` en ningun lado y asi se queda: las
 * herramientas son codigo del repo encendido por una bandera, no paquetes.
 *
 * Antes de eso se verifica algo mas basico: que TODO el codigo de la app viva en
 * `src/`. El escaneo mira ahi y solo ahi, asi que una carpeta hermana (el clasico
 * `plugins/`) pasaria entera sin ser leida y las dos aristas de arriba darian
 * verde sin haber revisado nada. Un escaneo con un punto ciego es peor que no
 * tenerlo: da la calma sin el control.
 *
 * ── E) Volverse instalable ESCONDE la pantalla, y eso pide relleno previo ────
 * Corolario de C que cuesta caro descubrir solo. Agregar `installable: true` a
 * una pantalla QUE YA SE USA no la ofrece: la HACE DESAPARECER de todos los
 * workspaces existentes, porque ninguno la tiene en `installed_features` y el
 * default de una instalable es "no instalada". Nadie la desinstalo; cambio la
 * regla bajo sus pies. El sintoma es un equipo que abre el lunes y le faltan
 * pantallas, sin nada en los logs, porque desde el codigo todo funciono bien.
 *
 * Por eso el conjunto instalable esta escrito a mano aqui. No es duplicar el
 * catalogo por gusto: es que este cambio no puede ser tacito. Quien agregue una
 * instalable va a ver este test en rojo y va a leer el porque antes de que se lo
 * cuente el equipo. La migracion de relleno va PRIMERO, la bandera despues.
 *
 * Determinista: solo lee fuentes y ejercita funciones puras, no monta rutas ni DB.
 *
 * Hoy 9 herramientas instalables en el catalogo y 0 archivos de src/ tocan el
 * disco. Un marketplace que empiece a escribir en disco cae aqui. Nunca un
 * silencio.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  FEATURES,
  INSTALLABLE_FEATURES,
  effectiveHidden,
  isInstallable,
  normalizeInstalled,
} from '@/lib/features'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const TOOLS_ROUTE = join(SRC, 'app', 'api', 'workspaces', '[workspaceId]', 'tools', 'route.ts')

// Carpetas de la raiz que NO son codigo de la app y por eso el escaneo las salta.
const NO_ES_CODIGO = new Set([
  'node_modules',
  '.next',
  '.git',
  '.vercel',
  '.github',
  'public',
  'docs',
  'supabase',
  'coverage',
  'playwright-report',
  'test-results',
])
// Carpetas donde SI puede vivir codigo. `src` es la app. `tests` son los
// tripwires, que leen disco a proposito: esa ES su tarea.
const CARPETAS_CON_CODIGO = new Set(['src', 'tests'])

function walkSrc(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkSrc(full, out)
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full)
  }
  return out
}

describe('Invariante del marketplace: instalar enciende una pantalla del repo, nunca codigo nuevo', () => {
  // ── A) el interruptor ──────────────────────────────────────────────────────
  const routeSrc = readFileSync(TOOLS_ROUTE, 'utf8')

  it('el interruptor exige admin del workspace', () => {
    expect(routeSrc).toMatch(/isWorkspaceAdminById\(/)
    expect(routeSrc).toMatch(/status: 403/)
  })

  it('el interruptor acota el id del workspace y pasa por rate limit', () => {
    expect(routeSrc).toMatch(/isUuid\(/)
    expect(routeSrc).toMatch(/applyRateLimit\(/)
  })

  it('el interruptor valida la clave contra el catalogo de codigo', () => {
    expect(routeSrc).toMatch(/isInstallable/)
    // Techo antes del refine: sin `.max` una cadena enorme se bufferiza entera
    // solo para ser rechazada.
    expect(routeSrc).toMatch(/z\.string\(\)\.max\(\d+\)\.refine\(isInstallable/)
  })

  it('el interruptor normaliza antes de escribir (no acumula claves muertas)', () => {
    expect(routeSrc).toMatch(/normalizeInstalled\(/)
  })

  // ── B) el catalogo ─────────────────────────────────────────────────────────
  it('toda herramienta instalable es una funcion real del catalogo y no esta bloqueada', () => {
    for (const f of INSTALLABLE_FEATURES) {
      expect(FEATURES.some((x) => x.key === f.key)).toBe(true)
      // Instalable + locked seria una pantalla obligatoria que no esta instalada.
      expect(f.locked).toBeFalsy()
      expect(isInstallable(f.key)).toBe(true)
    }
  })

  it('una clave que no esta en el catalogo no se puede instalar', () => {
    expect(isInstallable('wlo-flows')).toBe(false)
    expect(isInstallable('../../etc/passwd')).toBe(false)
    expect(isInstallable('')).toBe(false)
    // Una funcion base tampoco: no se instala lo que ya viene de fabrica.
    expect(isInstallable('home')).toBe(false)
  })

  it('normalizeInstalled descarta basura y no revive claves retiradas', () => {
    expect(normalizeInstalled(null)).toEqual([])
    expect(normalizeInstalled('contenidos')).toEqual([])
    expect(normalizeInstalled([42, {}, 'no-existe', 'home'])).toEqual([])
    const key = INSTALLABLE_FEATURES[0].key
    expect(normalizeInstalled([key, key])).toEqual([key])
  })

  // ── E) el conjunto instalable esta escrito a mano ──────────────────────────
  it('el conjunto instalable es exactamente este (cambiarlo pide migracion de relleno)', () => {
    // SI ESTE TEST ESTA EN ROJO Y VOS AGREGASTE `installable: true`:
    //
    // No basta con actualizar esta lista. Una pantalla que ya se usa DESAPARECE
    // de todos los workspaces existentes en cuanto se vuelve instalable, porque
    // ninguno la tiene en `installed_features` y el default de una instalable es
    // "no instalada". Sin error, sin log: el equipo abre el lunes y le falta una
    // pantalla.
    //
    // El orden es: (1) migracion que agrega la clave a `installed_features` de
    // todos los workspaces, (2) recien ahi la bandera en `src/lib/features.ts`,
    // (3) esta lista. Ver `supabase/migrations/20260807000000_marketplace_backfill.sql`
    // como molde: aditiva, idempotente y segura de correr antes del deploy.
    //
    // Si en cambio la QUITASTE del catalogo, no hay nada que hacer:
    // `normalizeInstalled()` descarta el residuo solo.
    const ESPERADAS = [
      'academia',
      'analytics',
      'contenidos',
      'cv',
      'flows',
      'goals',
      'projects',
      'tracking',
      'whiteboards',
    ]
    expect(INSTALLABLE_FEATURES.map((f) => f.key).sort()).toEqual(ESPERADAS)
  })

  it('las funciones de fabrica NO son instalables (son el piso de un workspace nuevo)', () => {
    // Un workspace recien creado tiene que poder trabajar sin pasar por el
    // marketplace. Si la bandeja de entrada o la guia de uso hubiera que
    // instalarlas, el primer dia de alguien nuevo seria una busqueda del tesoro.
    for (const key of ['home', 'inbox', 'my-tasks', 'general', 'reportes', 'notes', 'calendar', 'guia']) {
      expect(isInstallable(key)).toBe(false)
    }
  })

  it('el marketplace NO es instalable (la puerta no puede estar del lado de adentro)', () => {
    // Parece una mas de la lista de arriba y no lo es. Una herramienta instalable
    // arranca APAGADA. Si el marketplace fuera instalable, un workspace nuevo lo
    // tendria desinstalado y no habria pantalla desde donde instalarlo: quedaria
    // encerrado, sin ningun error que lo delate. El unico rescate seria editar la
    // columna a mano en la base.
    const def = FEATURES.find((f) => f.key === 'marketplace')
    expect(def).toBeDefined()
    expect(def!.installable).toBeFalsy()
    expect(isInstallable('marketplace')).toBe(false)
  })

  // ── C) la regla de plegado ─────────────────────────────────────────────────
  it('una herramienta instalable esta ESCONDIDA mientras el workspace no la instale', () => {
    for (const f of INSTALLABLE_FEATURES) {
      expect(effectiveHidden([], [])).toContain(f.key)
    }
  })

  it('instalarla la destapa, sin destapar lo que el admin escondio a esa persona', () => {
    const key = INSTALLABLE_FEATURES[0].key
    const hidden = effectiveHidden(['notes'], [key])
    expect(hidden).not.toContain(key)
    expect(hidden).toContain('notes')
  })

  it('desinstalarla la vuelve a esconder aunque el admin no haya escondido nada', () => {
    const key = INSTALLABLE_FEATURES[0].key
    expect(effectiveHidden([], [])).toContain(key)
  })

  // ── D) nada de disco ───────────────────────────────────────────────────────
  it('no hay codigo de aplicacion fuera de src/', () => {
    // Este test es la CONDICION que vuelve completos a los dos de abajo. Ellos
    // recorren `src/` y nada mas; si manana aparece un `plugins/` en la raiz con
    // handlers adentro, ese arbol queda fuera del escaneo y las dos aristas
    // siguientes pasan en verde sin haber mirado el codigo que importa. El
    // agujero no seria el codigo nuevo: seria que nadie lo revisa.
    //
    // Y no es hipotetico: asi se ve un marketplace "de verdad" cuando se lo
    // intenta hacer con paquetes en disco. La carpeta se llama `plugins/`, entra
    // sola, y el dia que alguien la lee ya tiene rutas propias.
    //
    // SI ESTE TEST ESTA EN ROJO: agregaste una carpeta con .ts/.tsx en la raiz.
    // Si es codigo de la app, va adentro de `src/` y listo. Si de verdad tiene
    // que vivir aparte, sumala a `CARPETAS_CON_CODIGO` Y sumala tambien al
    // escaneo de disco de los dos tests que siguen. Las dos cosas, no una.
    const inesperadas = readdirSync(ROOT)
      .filter((e) => !NO_ES_CODIGO.has(e) && !CARPETAS_CON_CODIGO.has(e))
      .filter((e) => statSync(join(ROOT, e)).isDirectory())
      .filter((d) => walkSrc(join(ROOT, d)).length > 0)
    expect(inesperadas.sort()).toEqual([])
  })

  it('ningun modulo de src/ toca el sistema de archivos', () => {
    // Un marketplace que sube paquetes necesita escribir en disco. En Vercel el
    // disco es de solo lectura (salvo /tmp, efimero) y ademas descomprimir un
    // paquete subido abre zip-slip y ejecucion de codigo sin revisar.
    const FS_IMPORT = /from ['"](node:)?fs(\/promises)?['"]|require\(['"](node:)?fs['"]\)/
    const ofensores: string[] = []
    const files = walkSrc(SRC)
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      if (FS_IMPORT.test(src)) ofensores.push(file.replace(SRC, '').replace(/\\/g, '/'))
    }
    expect(files.length).toBeGreaterThanOrEqual(200)
    expect(ofensores.sort()).toEqual([])
  })

  it('ningun modulo de src/ carga codigo por ruta dinamica', () => {
    // `require(variable)` / `import(variable)` con una ruta armada en tiempo de
    // ejecucion es como se carga un plugin desde disco, y es el paso final de la
    // cadena que convierte una subida en ejecucion.
    const DYNAMIC_LOAD = /require\s*\(\s*[^'")]/
    const ofensores: string[] = []
    for (const file of walkSrc(SRC)) {
      const src = readFileSync(file, 'utf8')
      if (DYNAMIC_LOAD.test(src)) ofensores.push(file.replace(SRC, '').replace(/\\/g, '/'))
    }
    expect(ofensores.sort()).toEqual([])
  })
})

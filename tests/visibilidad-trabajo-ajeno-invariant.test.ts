/**
 * Tripwire: el trabajo de una persona lo ve ella o su mando, y NUNCA todo el mundo.
 *
 * QUE SE DEFIENDE. Cuatro pantallas muestran lo que hizo la gente: el reporte
 * diario (dia, semana, calendario) y Analitica (horas registradas por persona).
 * La regla es la misma en las cuatro y esta escrita en `daily-report-access.ts`:
 * tu reporte es tuyo, el de los demas lo ven solo los mandos.
 *
 * POR QUE EXISTE ESTE ARCHIVO. Al 2026-08-03, Analitica IGNORABA la regla:
 * `getWorkspaceAdminContext` ya calculaba `isAdmin` y la pagina no lo miraba, asi
 * que cualquier miembro veia el desglose de horas de todo el equipo (un ranking
 * publico de quien trabajo cuanto). No se noto por una sola razon: `time_entries`
 * tiene cero filas. El dia que alguien registre tiempo, se enciende solo. Una
 * regla de privacidad que solo se cumple porque la tabla esta vacia no es una
 * regla, es una casualidad.
 *
 * DONDE VA EL RECORTE, y esto es el corazon del tripwire: en la CONSULTA, nunca al
 * pintar. Estas paginas leen con el admin client, que se salta RLS. Un filtro
 * puesto en el render deja los datos viajando al navegador igual, y ahi ya se
 * leen. Por eso no basta con comprobar que el archivo MENCIONA al mando: se exige
 * la ASIGNACION completa que recorta la query, y ademas que ocurra ANTES del await
 * que la ejecuta.
 *
 * Lee fuentes como texto. No monta DB ni rutas. Determinista y barato.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const RAIZ = process.cwd()
const APP = join(RAIZ, 'src', 'app', '(app)', 'w', '[workspaceSlug]')

const REPORTES_DIA = join(APP, 'reportes', 'page.tsx')
const REPORTES_SEMANA = join(APP, 'reportes', 'semana', 'page.tsx')
const REPORTES_CALENDARIO = join(APP, 'reportes', 'calendario', 'page.tsx')
const ANALYTICS = join(APP, 'analytics', 'page.tsx')
const ACCESO = join(RAIZ, 'src', 'lib', 'daily-report-access.ts')

const leer = (p: string) => readFileSync(p, 'utf8')

/** Indice de la primera coincidencia, o -1. Sirve para exigir ORDEN. */
function idx(src: string, re: RegExp): number {
  const m = re.exec(src)
  return m ? m.index : -1
}

describe('Invariante: nadie ve el trabajo ajeno sin ser mando', () => {
  it('las cuatro pantallas siguen existiendo (defensa contra falso verde)', () => {
    for (const f of [REPORTES_DIA, REPORTES_SEMANA, REPORTES_CALENDARIO, ANALYTICS, ACCESO]) {
      expect(existsSync(f), `desaparecio ${f}: el tripwire estaria pasando sobre nada`).toBe(true)
    }
  })

  it('la regla de quien es mando sigue viviendo en UN solo lugar', () => {
    const src = leer(ACCESO)
    expect(
      /export\s+async\s+function\s+isReportSupervisor/.test(src),
      'se perdio isReportSupervisor: la regla de privacidad se va a reimplementar en cada pantalla y se va a romper en la cuarta',
    ).toBe(true)
    // Anclado al criterio, no al nombre: si deja de mirar owner/admin, la funcion
    // sigue existiendo y ya no filtra a nadie.
    expect(
      /orgRole\s*===\s*'owner'\s*\|\|\s*orgRole\s*===\s*'admin'/.test(src),
      'isReportSupervisor dejo de reconocer al mando de la organizacion',
    ).toBe(true)
    expect(
      /role\s*===\s*'owner'\s*\|\|\s*role\s*===\s*'admin'/.test(src),
      'isReportSupervisor dejo de reconocer al mando del workspace',
    ).toBe(true)
  })

  // ── Reporte diario: vista de dia y de semana ───────────────────────────────
  // Mismo patron en las dos: query mutable, recorte condicional, await al final.
  for (const [nombre, archivo] of [
    ['dia', REPORTES_DIA],
    ['semana', REPORTES_SEMANA],
  ] as const) {
    it(`reporte diario (${nombre}): el recorte va en la consulta y antes del await`, () => {
      const src = leer(archivo)

      expect(
        /const\s+isSupervisor\s*=\s*await\s+isReportSupervisor\(/.test(src),
        `la vista de ${nombre} dejo de preguntar quien es mando: todos ven el reporte de todos`,
      ).toBe(true)

      const iRecorte = idx(
        src,
        /if\s*\(\s*!isSupervisor\s*\)\s*reportQuery\s*=\s*reportQuery\.eq\(\s*['"]profile_id['"]\s*,\s*user\.id\s*\)/,
      )
      expect(
        iRecorte,
        `la vista de ${nombre} ya no recorta la consulta a (!isSupervisor -> solo mi profile_id): quien no es mando pasa a leer los reportes de sus compañeros`,
      ).toBeGreaterThan(-1)

      const iAwait = idx(src, /await\s+reportQuery/)
      expect(iAwait, `no se encontro el await de reportQuery en la vista de ${nombre}`).toBeGreaterThan(-1)
      // El orden ES la garantia: recortar despues del await significa que las filas
      // ajenas ya se trajeron y solo se escondieron al pintar.
      expect(
        iRecorte < iAwait,
        `en la vista de ${nombre} el recorte quedo DESPUES de ejecutar la consulta: los reportes ajenos ya viajaron al navegador aunque no se pinten`,
      ).toBe(true)
    })
  }

  // ── Reporte diario: calendario ────────────────────────────────────────────
  // Aqui el patron es al reves y a proposito: el alcance NACE en uno mismo y solo
  // un mando puede ampliarlo. Es fail-closed, y por eso se vigila distinto.
  it('reporte diario (calendario): el alcance nace propio y solo el mando lo amplia', () => {
    const src = leer(REPORTES_CALENDARIO)

    expect(
      /const\s+isSupervisor\s*=\s*await\s+isReportSupervisor\(/.test(src),
      'el calendario dejo de preguntar quien es mando',
    ).toBe(true)

    expect(
      /let\s+profileId:\s*string\s*\|\s*null\s*=\s*user\.id/.test(src),
      'el calendario ya no arranca con el alcance en uno mismo: si el default deja de ser propio, el fallo abre en vez de cerrar',
    ).toBe(true)

    const iAmplia = idx(src, /if\s*\(\s*isSupervisor\s*\)\s*\{/)
    const iRecorte = idx(src, /if\s*\(\s*profileId\s*\)\s*q\s*=\s*q\.eq\(\s*['"]profile_id['"]\s*,\s*profileId\s*\)/)
    const iAwait = idx(src, /await\s+q\./)

    expect(
      iAmplia,
      'el calendario ya no condiciona a isSupervisor la ampliacion del alcance: cualquiera podria pedir ?p=equipo',
    ).toBeGreaterThan(-1)
    expect(
      iRecorte,
      'el calendario dejo de aplicar el alcance a la consulta (q.eq(profile_id, profileId))',
    ).toBeGreaterThan(-1)
    expect(iAwait, 'no se encontro el await de la consulta del calendario').toBeGreaterThan(-1)
    expect(
      iRecorte < iAwait,
      'en el calendario el alcance se aplica DESPUES de ejecutar la consulta: los reportes ajenos ya se trajeron',
    ).toBe(true)
  })

  // ── Analitica ─────────────────────────────────────────────────────────────
  it('Analitica: el tiempo registrado se recorta en la consulta cuando quien mira no es mando', () => {
    const src = leer(ANALYTICS)

    expect(
      /ctx\.isAdmin/.test(src),
      'Analitica volvio a ignorar ctx.isAdmin: cualquier miembro ve el desglose de horas por persona de todo el workspace, que es un ranking publico de quien trabajo cuanto',
    ).toBe(true)

    // Anclado a la ASIGNACION completa y no a la palabra "isAdmin": un tripwire que
    // solo confirma que el tema se menciona da la calma sin el control.
    const iRecorte = idx(
      src,
      /if\s*\(\s*!ctx\.isAdmin\s*\)\s*timeQuery\s*=\s*timeQuery\.eq\(\s*['"]profile_id['"]\s*,\s*ctx\.userId\s*\)/,
    )
    expect(
      iRecorte,
      'Analitica ya no recorta time_entries a (!isAdmin -> solo mi profile_id): vuelve la fuga de horas ajenas',
    ).toBeGreaterThan(-1)

    const iAwait = idx(src, /await\s+timeQuery/)
    expect(iAwait, 'no se encontro el await de timeQuery en Analitica').toBeGreaterThan(-1)
    expect(
      iRecorte < iAwait,
      'en Analitica el recorte quedo DESPUES del await: las horas ajenas ya se leyeron de la base. Recortar al pintar no sirve, estas paginas usan el admin client y se saltan RLS',
    ).toBe(true)
  })

  it('Analitica: la vista sabe que esta mostrando solo lo propio (no miente el encabezado)', () => {
    // Un recorte silencioso es peor que ninguno: el miembro leeria "Horas del
    // equipo" viendo solo las suyas y concluiria que nadie trabaja.
    expect(
      /soloPropio=\{\s*!ctx\.isAdmin\s*\}/.test(leer(ANALYTICS)),
      'Analitica dejo de avisarle a la vista que el dato viene recortado: los rotulos dirian "del equipo" mostrando solo lo propio',
    ).toBe(true)
    expect(
      /soloPropio/.test(leer(join(RAIZ, 'src', 'components', 'analytics', 'AnalyticsView.tsx'))),
      'AnalyticsView ya no distingue el caso recortado: vuelve a rotular como si fuera el total del equipo',
    ).toBe(true)
  })
})

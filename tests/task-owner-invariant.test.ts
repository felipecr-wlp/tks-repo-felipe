/**
 * Tripwire: una tarea no puede NACER sin responsable.
 *
 * Lo que se defiende y por que existe. Al 2026-08-03 el workspace activo tenia 47
 * tareas, 46 sin responsable y CERO completadas en cinco semanas. No fue descuido
 * del equipo: ninguna de las tres pantallas de creacion mandaba `assignee_id` y
 * cuatro de las seis rutas que insertan tareas tampoco, asi que era IMPOSIBLE
 * crear una tarea con dueño en un solo paso. Una tarea sin responsable no le
 * aparece a nadie en "Mis tareas" (esa vista filtra por assignee_id), no dispara
 * la notificacion de asignacion y no entra en ningun conteo por persona.
 *
 * La garantia vive en un trigger BEFORE INSERT sobre `tasks`
 * (20260809000000_tarea_siempre_nace_con_responsable.sql) y no en las rutas, justo
 * porque las rutas son seis y la septima la escribe alguien el mes que viene.
 *
 * Estos tests leen los .sql como texto. No montan DB. Deterministas y baratos.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
const TRIGGER = 'tasks_default_assignee'
const FUNCION = 'tasks_set_default_assignee'

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
}

/** Quita comentarios de linea para no matchear SQL comentado. */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const i = line.indexOf('--')
      return i === -1 ? line : line.slice(0, i)
    })
    .join('\n')
}

/** Todas las migraciones concatenadas EN ORDEN, ya sin comentarios. */
function sqlEnOrden(): string {
  return migrationFiles()
    .map((f) => stripLineComments(readFileSync(join(MIGRATIONS, f), 'utf8')))
    .join('\n')
}

describe('Invariante: toda tarea nace con responsable', () => {
  it('el scan no esta vacio (defensa contra falso verde)', () => {
    expect(migrationFiles().length).toBeGreaterThanOrEqual(10)
  })

  it('la funcion que pone el responsable por defecto sigue existiendo', () => {
    expect(
      new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${FUNCION}\\b`, 'i').test(sqlEnOrden()),
      `se perdio la funcion ${FUNCION}: las tareas vuelven a poder nacer huerfanas y a no aparecerle a nadie en "Mis tareas"`,
    ).toBe(true)
  })

  it('la funcion realmente cae en el creador, no solo se llama bonito', () => {
    const sql = sqlEnOrden()
    const cuerpo = sql.slice(sql.search(new RegExp(`FUNCTION\\s+public\\.${FUNCION}\\b`, 'i')))
    // Anclado a la ASIGNACION completa, no a la palabra "created_by" suelta: un
    // tripwire que solo confirma que el tema se menciona da la calma sin el control.
    expect(
      /NEW\.assignee_id\s*:=\s*NEW\.created_by/i.test(cuerpo.slice(0, 800)),
      `${FUNCION} ya no asigna NEW.created_by: el trigger existe pero dejo de hacer lo unico que tenia que hacer`,
    ).toBe(true)
  })

  it('el trigger sigue vivo: la ultima palabra sobre el no es un DROP', () => {
    const sql = sqlEnOrden()
    const ultimoCreate = sql.toLowerCase().lastIndexOf(`create trigger ${TRIGGER}`)
    const ultimoDrop = sql.toLowerCase().lastIndexOf(`drop trigger if exists ${TRIGGER}`)

    expect(ultimoCreate, `nunca se creo el trigger ${TRIGGER}`).toBeGreaterThan(-1)
    // El DROP+CREATE del mismo archivo es el patron idempotente de la casa, asi que
    // lo que se vigila es el ORDEN: el CREATE tiene que ser lo ultimo.
    expect(
      ultimoCreate > ultimoDrop,
      `una migracion posterior elimina ${TRIGGER} sin volver a crearlo: las tareas nuevas vuelven a nacer sin dueño`,
    ).toBe(true)
  })

  it('el trigger corre BEFORE INSERT y NO sobre UPDATE (desasignar debe seguir siendo posible)', () => {
    const sql = sqlEnOrden()
    const i = sql.toLowerCase().lastIndexOf(`create trigger ${TRIGGER}`)
    const decl = sql.slice(i, i + 300)

    expect(
      /BEFORE\s+INSERT/i.test(decl),
      `${TRIGGER} dejo de ser BEFORE INSERT: si corre despues, la fila ya se guardo sin responsable`,
    ).toBe(true)

    // Extenderlo a UPDATE parece "mas seguro" y rompe la app: quitarle el
    // responsable a una tarea es una accion deliberada que ofrece la barra de
    // TaskRow, y con el trigger en UPDATE se volveria a poner sola.
    expect(
      /BEFORE\s+INSERT\s+OR\s+UPDATE/i.test(decl),
      `${TRIGGER} se extendio a UPDATE: desasignar deja de funcionar en toda la app porque el responsable se repone solo`,
    ).toBe(false)
  })

  it('"Mis tareas" sigue filtrando por assignee_id (es lo que le da sentido al trigger)', () => {
    const vista = join(process.cwd(), 'src', 'app', '(app)', 'w', '[workspaceSlug]', 'my-tasks', 'page.tsx')
    expect(
      /\.eq\(\s*['"]assignee_id['"]/.test(readFileSync(vista, 'utf8')),
      'la vista "Mis tareas" dejo de filtrar por assignee_id: el trigger sigue poniendo responsable pero ya nadie lo lee, que es volver al problema por otra puerta',
    ).toBe(true)
  })
})

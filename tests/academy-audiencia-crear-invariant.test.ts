/**
 * Tripwire: crear y editar un video tienen que aceptar LOS MISMOS campos de
 * audiencia.
 *
 * EL FALLO QUE ESTO EVITA, y que ya paso una vez. `audience` se agrego solo al
 * esquema de PATCH. Zod descarta las claves que no declara, sin quejarse: el
 * POST recibia `audience: 'perfiles'`, respondia 201, y guardaba el default
 * 'todos'. O sea el video marcado "solo foreman" quedaba visible para toda la
 * empresa, con la peticion diciendo que todo salio bien.
 *
 * Un fallo de permisos que contesta OK no lo descubre nadie: no hay error que
 * investigar, y quien lo configuro se va tranquilo. Solo se ve auditando la
 * base a mano, que es justo lo que nadie hace.
 *
 * Determinista: solo lee las dos fuentes.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const API = join(process.cwd(), 'src', 'app', 'api', 'academy', 'videos')
const crear = readFileSync(join(API, 'route.ts'), 'utf8')
const editar = readFileSync(join(API, '[videoId]', 'route.ts'), 'utf8')

/** Campos que deciden QUIEN VE el contenido. */
const CAMPOS_DE_PERMISO = ['audience', 'audienceProfiles']

describe('Invariante: la audiencia se puede fijar al CREAR, no solo al editar', () => {
  for (const campo of CAMPOS_DE_PERMISO) {
    it(`el esquema de creacion declara "${campo}"`, () => {
      // Se busca en la definicion del esquema, no en todo el archivo: que la
      // palabra aparezca en un comentario no prueba nada.
      const esquema = crear.slice(crear.indexOf('const crearSchema'), crear.indexOf('/** El objeto existe'))
      expect(esquema).toContain(`${campo}:`)
    })

    it(`el esquema de edicion declara "${campo}"`, () => {
      expect(editar).toContain(`${campo}:`)
    })
  }

  it('la creacion ESCRIBE la audiencia en la fila, no solo la valida', () => {
    // Declararla en el esquema y olvidar pasarla al insert deja el mismo
    // agujero, con el esquema dando una falsa sensacion de cobertura.
    // Ojo con el recorte: el primer `.select(` del archivo esta en el GET,
    // muy ARRIBA del insert. Buscarlo sin offset daba un rango invertido y un
    // string vacio, o sea un test que fallaba con el codigo correcto.
    const desde = crear.indexOf('.insert({')
    const insert = crear.slice(desde, crear.indexOf('.select(', desde))
    expect(insert).toContain('audience:')
    expect(insert).toContain('audience_profiles:')
  })
})

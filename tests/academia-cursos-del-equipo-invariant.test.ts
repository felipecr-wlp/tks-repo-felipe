/**
 * Tripwire: los cursos que escribe el equipo no pueden romper la Academia
 * oficial, ni certificar a nadie por un examen que califica mal.
 *
 * QUE PROTEGE, EN CONCRETO. Cualquiera dentro de la organizacion puede escribir
 * un curso; publicarlo pasa por revision de un admin. Eso abre tres agujeros que
 * NINGUNO se manifiesta como error, y por eso se vigilan aqui:
 *
 *   1. COLISION DE NAMESPACE. `academy_access`, `academy_progress` y
 *      `academy_certificates` guardan `course_id` como TEXTO PELADO, sin llave
 *      foranea. Un curso del equipo llamado "seo" compartiria fila de progreso y
 *      certificados con el curso OFICIAL de SEO: el avance de uno marcaria
 *      completo el otro. La defensa es el prefijo obligatorio `eq-`, respaldado
 *      por un CHECK en la base. Toda esa defensa se apoya en UN hecho que este
 *      archivo verifica: que ningun curso oficial empiece con `eq-`. Si alguien
 *      publica manana un curso oficial con ese prefijo, la separacion se cae en
 *      silencio y solo se notaria cuando dos personas distintas reclamaran el
 *      mismo certificado.
 *
 *   2. QUIZ QUE CALIFICA MAL. Es el mismo fallo silencioso que
 *      `academia-conocimiento-no-trivia-invariant` vigila en el contenido
 *      oficial, pero un curso del equipo vive en la BASE y NO pasa por CI: nadie
 *      lo va a revisar en un diff. La unica oportunidad de atraparlo es al
 *      escribirlo, y por eso `validarCurso` corre antes de dejar enviar a
 *      revision. Aqui se comprueba que de verdad atrapa cada defecto, no que
 *      exista la funcion.
 *
 *   3. APROBACION DE ADORNO. Si el autor pudiera editar un curso YA PUBLICADO,
 *      bastaria con publicar algo inocuo y cambiarlo despues: la revision seria
 *      teatro. Y si un admin pudiera aprobar el suyo, no habria segundo par de
 *      ojos. Las dos cosas se comprueban recorriendo la maquina de estados
 *      ENTERA, no un par de casos elegidos a mano.
 *
 * Se prueban modulos PUROS (`validar-curso`, `flujo-curso`) a proposito: la
 * autorizacion de esta feature se puede interrogar sin levantar Next ni la base,
 * asi que se prueba de verdad y no "por encima".
 */
import { describe, it, expect } from 'vitest'
import { COURSES } from '@/lib/academy/courses'
import {
  idDesdeTitulo,
  validarCurso,
  RE_COURSE_ID,
  MIN_PREGUNTAS_POR_MODULO,
  type ProblemaCurso,
} from '@/lib/academy/validar-curso'
import {
  TRANSICIONES,
  evaluarAccion,
  type AccionCurso,
  type EstadoCurso,
} from '@/lib/academy/flujo-curso'
import { PREFIJO_EQUIPO, esCursoDeEquipo } from '@/lib/academy/catalog'

const ESTADOS: EstadoCurso[] = ['draft', 'pending_review', 'published', 'rejected', 'archived']
const ACCIONES = Object.keys(TRANSICIONES) as AccionCurso[]

/** Un curso minimo pero VALIDO. Cada prueba lo rompe de una sola forma. */
function cursoValido() {
  return {
    title: 'Cómo cotizar un estacionamiento',
    subtitle: 'De la visita al número',
    modules: [
      {
        id: 'medicion',
        title: 'Medición en sitio',
        lessons: [{ t: 'Qué se mide', blocks: [{ type: 'p', v: 'Se mide el área útil.' }] }],
        quiz: [
          { q: '¿Qué se mide primero?', opts: ['El área', 'El clima'], a: 0, ex: 'Sin área no hay volumen.' },
          { q: '¿Con qué se mide?', opts: ['Rueda de medición', 'A ojo'], a: 0, ex: 'A ojo no es medir.' },
          { q: '¿Se anota el espesor?', opts: ['Sí', 'No'], a: 0, ex: 'El espesor manda en el costo.' },
        ],
      },
    ],
  }
}

/** Todos los problemas en un solo texto, para afirmar sobre lo que DICE. */
function texto(problemas: ProblemaCurso[]): string {
  return problemas.map((p) => `${p.donde}: ${p.que}`).join('\n')
}

describe('Invariante: los cursos del equipo no contaminan la Academia oficial', () => {
  it('el catálogo oficial sigue ahí (defensa contra falso verde)', () => {
    // Sin esto, un courses.ts vacío pondría en verde la prueba de namespace de
    // abajo sin haber comprobado absolutamente nada.
    expect(COURSES.length, 'se quedó sin cursos oficiales').toBeGreaterThanOrEqual(12)
  })

  it('NINGÚN curso oficial usa el prefijo del equipo', () => {
    // Este es el hecho sobre el que se apoya toda la separación de namespace.
    const invasores = COURSES.filter((c) => c.id.startsWith(PREFIJO_EQUIPO)).map((c) => c.id)
    expect(
      invasores,
      `estos cursos oficiales invaden el prefijo "${PREFIJO_EQUIPO}", reservado para los cursos del equipo. ` +
        'Como course_id es texto pelado sin llave foránea, compartirían progreso y certificados ' +
        'con un curso del equipo del mismo nombre, y nadie se enteraría.',
    ).toEqual([])
  })

  it('el resolvedor distingue origen sin consultar nada', () => {
    for (const c of COURSES) {
      expect(esCursoDeEquipo(c.id), `${c.id} se está resolviendo como curso del equipo`).toBe(false)
    }
    expect(esCursoDeEquipo('eq-cotizar')).toBe(true)
  })

  it('el mínimo que se le exige al equipo es el que el contenido oficial YA cumple', () => {
    // Si alguien sube MIN_PREGUNTAS_POR_MODULO por encima de lo que cumple el
    // contenido oficial, le estaría pidiendo al equipo un estándar que la propia
    // casa no cumple. Esa es la clase de regla que la gente ignora.
    const flojos = COURSES.flatMap((c) =>
      c.modules
        .filter((m) => (m.quiz ?? []).length < MIN_PREGUNTAS_POR_MODULO)
        .map((m) => `${c.id}/${m.id} (${(m.quiz ?? []).length})`),
    )
    expect(
      flojos,
      `estos módulos oficiales no llegan a ${MIN_PREGUNTAS_POR_MODULO} preguntas, ` +
        'así que el mínimo que se le pide al equipo dejó de estar respaldado por el ejemplo propio',
    ).toEqual([])
  })
})

/**
 * `idDesdeTitulo` está defendido DOS VECES: recorta y normaliza la base, y
 * además contrasta el resultado contra el mismo regex que la base impone como
 * CHECK. Comprobado saboteando: romper UNA sola de las dos guardas no pone esto
 * en rojo, porque la otra sigue devolviendo null. Es redundancia a propósito, no
 * una prueba floja: hicieron falta dos sabotajes simultáneos para que mordiera,
 * y mordió en los cuatro casos (id largo, id corto, separador inválido, tildes).
 */
describe('Invariante: un id generado por el sistema siempre es un id válido', () => {
  const TITULOS = [
    'Cómo cotizar un estacionamiento',
    'Diseño de señalética y ñandúes',
    'ASFALTO 101',
    '  espacios   raros  ',
    '¿Qué es el sellado?',
    'a'.repeat(300),
    'Curso 🚧 con emoji 🚜',
    '¡¿!?¡¿!?',
    '---',
    'a',
    'ab',
    'Título / con / diagonales',
    'C++ y C#',
    '2026',
  ]

  it('devuelve un id que pasa el CHECK de la base, o null, nunca algo intermedio', () => {
    for (const t of TITULOS) {
      const id = idDesdeTitulo(t)
      if (id === null) continue
      expect(
        RE_COURSE_ID.test(id),
        `el título ${JSON.stringify(t)} generó "${id}", que la base rechazaría con un 500 sin explicación`,
      ).toBe(true)
      expect(esCursoDeEquipo(id), `"${id}" no se reconocería como curso del equipo`).toBe(true)
    }
  })

  it('rechaza los títulos de los que no queda nada utilizable', () => {
    // Devolver "" o "eq-" sería peor que devolver null: la ruta lo aceptaría.
    expect(idDesdeTitulo('¡¿!?¡¿!?')).toBeNull()
    expect(idDesdeTitulo('---')).toBeNull()
    expect(idDesdeTitulo('a')).toBeNull()
  })

  it('conserva la letra al quitar la tilde, en vez de comerse el carácter', () => {
    expect(idDesdeTitulo('Diseño de campañas')).toBe('eq-diseno-de-campanas')
  })

  it('el regex de id no acepta el namespace oficial', () => {
    for (const malo of ['seo', 'sem', 'eq-', 'EQ-curso', 'eq-Curso', 'eq-x', 'curso-eq']) {
      expect(RE_COURSE_ID.test(malo), `"${malo}" pasó el CHECK y no debería`).toBe(false)
    }
  })
})

describe('Invariante: el validador atrapa los defectos que nadie ve leyendo', () => {
  it('un curso correcto no inventa problemas (defensa contra falso rojo)', () => {
    expect(texto(validarCurso(cursoValido()))).toBe('')
  })

  it('atrapa la respuesta correcta que apunta fuera de las opciones', () => {
    // El defecto central: el quiz NO truena, califica mal en silencio y para
    // siempre. Sin esta comprobación el validador podría no mirarlo nunca.
    const curso = cursoValido()
    curso.modules[0].quiz[1].a = 7
    const p = validarCurso(curso)
    expect(p.length, 'el índice fuera de rango pasó sin más').toBeGreaterThan(0)
    expect(texto(p)).toContain('Pregunta 2')
  })

  it('atrapa el índice negativo y el que no es entero', () => {
    for (const a of [-1, 1.5, NaN]) {
      const curso = cursoValido()
      curso.modules[0].quiz[0].a = a
      expect(validarCurso(curso).length, `a=${a} pasó sin más`).toBeGreaterThan(0)
    }
  })

  it('atrapa el módulo sin quiz suficiente (el callejón sin salida)', () => {
    // Un módulo sin examen se ve perfecto y jamás se puede completar: el avance
    // solo se guarda al aprobar un quiz, así que el curso nunca llega a 100% y
    // el certificado NUNCA se emite. Nada falla; la persona estudia para nada.
    const curso = cursoValido()
    curso.modules[0].quiz = []
    expect(texto(validarCurso(curso))).toContain('certificado')
  })

  it('atrapa dos módulos con el mismo identificador', () => {
    const curso = cursoValido()
    curso.modules.push({ ...cursoValido().modules[0] })
    expect(texto(validarCurso(curso))).toContain('repetido')
  })

  it('atrapa el módulo sin identificador', () => {
    const curso = cursoValido()
    curso.modules[0].id = ''
    expect(texto(validarCurso(curso))).toContain('identificador')
  })

  it('atrapa opciones vacías y opciones repetidas', () => {
    const vacia = cursoValido()
    vacia.modules[0].quiz[0].opts = ['Sí', '   ']
    expect(validarCurso(vacia).length).toBeGreaterThan(0)

    const repe = cursoValido()
    repe.modules[0].quiz[0].opts = ['Sí', 'Sí']
    expect(texto(validarCurso(repe))).toContain('repetidas')
  })

  it('atrapa la pregunta de una sola opción', () => {
    const curso = cursoValido()
    curso.modules[0].quiz[0].opts = ['Sí']
    expect(validarCurso(curso).length).toBeGreaterThan(0)
  })

  it('atrapa la explicación que falta', () => {
    const curso = cursoValido()
    curso.modules[0].quiz[0].ex = ''
    expect(texto(validarCurso(curso))).toContain('explicación')
  })

  it('atrapa el curso sin módulos y la lección vacía', () => {
    const sinModulos = { ...cursoValido(), modules: [] }
    expect(validarCurso(sinModulos).length).toBeGreaterThan(0)

    const sinBloques = cursoValido()
    sinBloques.modules[0].lessons[0].blocks = []
    expect(validarCurso(sinBloques).length).toBeGreaterThan(0)

    const bloqueRaro = cursoValido()
    bloqueRaro.modules[0].lessons[0].blocks = [{ type: 'iframe', v: '<script>' }]
    expect(validarCurso(bloqueRaro).length).toBeGreaterThan(0)
  })

  it('no se cae si le pasan basura en vez de módulos', () => {
    // Llega de un JSON de la base: puede ser cualquier cosa.
    for (const modules of [null, undefined, 'texto', 42, {}, [null], [{}]]) {
      expect(() => validarCurso({ title: 'X', modules })).not.toThrow()
    }
    expect(validarCurso({ title: 'X', modules: [null] }).length).toBeGreaterThan(0)
  })

  it('devuelve TODOS los problemas de una vez, no solo el primero', () => {
    // Corregir de uno en uno, enviando y volviendo a fallar, es la forma más
    // rápida de que alguien abandone el curso que estaba escribiendo.
    const curso = cursoValido()
    curso.title = ''
    curso.modules[0].id = ''
    curso.modules[0].quiz[0].ex = ''
    expect(validarCurso(curso).length).toBeGreaterThanOrEqual(3)
  })
})

describe('Invariante: la aprobación no es teatro', () => {
  /** Recorre la máquina ENTERA: 7 acciones x 5 estados x autor x admin x nota. */
  function todosLosCasos() {
    const casos = []
    for (const accion of ACCIONES) {
      for (const estadoActual of ESTADOS) {
        for (const esAutor of [true, false]) {
          for (const esAdmin of [true, false]) {
            for (const tieneNota of [true, false]) {
              const args = { accion, estadoActual, esAutor, esAdmin, tieneNota }
              casos.push({ ...args, veredicto: evaluarAccion(args), regla: TRANSICIONES[accion] })
            }
          }
        }
      }
    }
    return casos
  }

  it('la tabla cubre todas las acciones y ningún destino es inventado', () => {
    for (const accion of ACCIONES) {
      const r = TRANSICIONES[accion]
      expect(r, `la acción "${accion}" no tiene fila`).toBeTruthy()
      expect(r.desde.length, `"${accion}" no sale de ningún estado`).toBeGreaterThan(0)
      for (const e of r.desde) expect(ESTADOS).toContain(e)
      if (r.hacia !== null) expect(ESTADOS).toContain(r.hacia)
    }
  })

  it('a "published" solo se llega aprobando, desde revisión y por otro par de ojos', () => {
    const publicaciones = todosLosCasos().filter((c) => c.veredicto.ok && c.regla.hacia === 'published')
    expect(publicaciones.length, 'nadie puede publicar: la máquina quedó muerta').toBeGreaterThan(0)
    for (const c of publicaciones) {
      expect(c.accion, 'hay otra acción que publica').toBe('aprobar')
      expect(c.estadoActual, 'se publicó saltándose la revisión').toBe('pending_review')
      expect(c.esAdmin, 'publicó alguien que no es admin').toBe(true)
      expect(c.esAutor, 'el autor aprobó su propio curso: no hubo revisión').toBe(false)
      expect(c.regla.validaContenido, 'se publicó sin validar el contenido').toBe(true)
    }
  })

  it('el autor NO puede editar un curso publicado', () => {
    // Si pudiera, bastaría con publicar algo inocuo y cambiarlo después.
    const editables = todosLosCasos().filter(
      (c) => c.veredicto.ok && c.accion === 'guardar' && c.estadoActual === 'published',
    )
    expect(editables, 'un curso publicado se puede editar: la aprobación es teatro').toEqual([])
  })

  // Las dos siguientes NO se derivan de la tabla: nombran las acciones a mano.
  // Filtrar por `c.regla.exigeNota` sería leer la regla para comprobar la regla,
  // y borrar la bandera dejaría la prueba en verde sin haber comprobado nada.
  // Comprobado: sin estas dos listas explícitas, quitar `exigeNota` no muerde.

  it('las decisiones sobre el curso ajeno exigen NO ser el autor', () => {
    const DECIDEN: AccionCurso[] = ['aprobar', 'rechazar']
    for (const accion of DECIDEN) {
      const v = evaluarAccion({
        accion,
        estadoActual: 'pending_review',
        esAutor: true,
        esAdmin: true, // admin y autor a la vez: el caso que de verdad importa
        tieneNota: true,
      })
      expect(
        v.ok,
        `"${accion}" procedió sobre el propio curso. La revisión existe para que haya un segundo ` +
          'par de ojos; si el autor es el revisor, no hay ninguno.',
      ).toBe(false)
    }
  })

  it('rechazar sin decir por qué no procede', () => {
    const v = evaluarAccion({
      accion: 'rechazar',
      estadoActual: 'pending_review',
      esAutor: false,
      esAdmin: true,
      tieneNota: false,
    })
    expect(
      v.ok,
      'se rechazó sin motivo. Rechazar sin decir por qué es la forma más rápida de que esa ' +
        'persona no vuelva a escribir un curso nunca.',
    ).toBe(false)
  })

  it('ninguna acción con nota obligatoria procede muda (barrido, para las que vengan)', () => {
    const mudos = todosLosCasos().filter((c) => c.veredicto.ok && c.regla.exigeNota && !c.tieneNota)
    expect(mudos.map((c) => c.accion), 'se decidió sin motivo').toEqual([])
  })

  it('ninguna acción procede para quien no le corresponde', () => {
    const colados = todosLosCasos().filter(
      (c) => c.veredicto.ok && (c.regla.quien === 'autor' ? !c.esAutor : !c.esAdmin),
    )
    expect(colados.map((c) => `${c.accion}`), 'alguien sin rol pasó').toEqual([])
  })

  it('ninguna acción procede desde un estado que no la admite', () => {
    const saltos = todosLosCasos().filter(
      (c) => c.veredicto.ok && !c.regla.desde.includes(c.estadoActual),
    )
    expect(saltos.map((c) => `${c.accion} desde ${c.estadoActual}`)).toEqual([])
  })

  it('archivado es final: de ahí no sale nada', () => {
    const salidas = todosLosCasos().filter((c) => c.veredicto.ok && c.estadoActual === 'archived')
    expect(salidas.map((c) => c.accion), 'se revivió un curso archivado').toEqual([])
  })

  it('el camino legítimo completo sí procede (defensa contra falso verde)', () => {
    // Si TODO estuviera prohibido, cada prueba de arriba pasaría sin sentido.
    const autor = { esAutor: true, esAdmin: false, tieneNota: false }
    const admin = { esAutor: false, esAdmin: true, tieneNota: true }
    expect(evaluarAccion({ accion: 'guardar', estadoActual: 'draft', ...autor }).ok).toBe(true)
    expect(evaluarAccion({ accion: 'enviar', estadoActual: 'draft', ...autor }).ok).toBe(true)
    expect(evaluarAccion({ accion: 'retirar', estadoActual: 'pending_review', ...autor }).ok).toBe(true)
    expect(evaluarAccion({ accion: 'rechazar', estadoActual: 'pending_review', ...admin }).ok).toBe(true)
    expect(evaluarAccion({ accion: 'guardar', estadoActual: 'rejected', ...autor }).ok).toBe(true)
    expect(evaluarAccion({ accion: 'aprobar', estadoActual: 'pending_review', ...admin }).ok).toBe(true)
    expect(evaluarAccion({ accion: 'reabrir', estadoActual: 'published', ...admin }).ok).toBe(true)
    expect(evaluarAccion({ accion: 'archivar', estadoActual: 'published', ...admin }).ok).toBe(true)
  })

  it('el motivo del rechazo trae código HTTP utilizable', () => {
    const v = evaluarAccion({
      accion: 'aprobar',
      estadoActual: 'draft',
      esAutor: false,
      esAdmin: true,
      tieneNota: false,
    })
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect([403, 409, 422]).toContain(v.estado)
      expect(v.error.length).toBeGreaterThan(0)
    }
  })
})

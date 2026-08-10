/**
 * Validacion de un curso escrito por el equipo, ANTES de que pueda enviarse a
 * revision.
 *
 * POR QUE EN CODIGO Y NO "QUE EL REVISOR SE FIJE". Hay defectos que un revisor
 * humano NO puede ver leyendo el curso:
 *
 *   - Una pregunta cuyo indice de respuesta correcta apunta fuera de la lista de
 *     opciones. El quiz no truena: CALIFICA MAL, en silencio, para siempre. Es
 *     el mismo fallo que el tripwire `academia-conocimiento-no-trivia-invariant`
 *     vigila en los cursos oficiales; aqui se vigila al escribir, porque un
 *     curso en BD no pasa por CI.
 *   - Un modulo SIN QUIZ. Se ve perfecto y es un callejon sin salida: el
 *     progreso solo se guarda al aprobar un quiz, asi que ese modulo nunca se
 *     marca completo, el curso nunca llega a 100% y el certificado NUNCA se
 *     puede emitir. La persona estudia y no obtiene nada, sin un solo error.
 *
 * EL ESTANDAR NO ES INVENTADO. Los 12 cursos oficiales tienen 50 modulos y
 * ninguno baja de 3 preguntas (205 en total). Se le pide al equipo lo mismo que
 * ya cumple el contenido oficial, ni mas ni menos.
 */
import type { Module, QuizQuestion } from './types'

/** Un defecto concreto, con el lugar exacto donde esta. */
export interface ProblemaCurso {
  /** Ruta legible: "Modulo 2 / Leccion 1" */
  donde: string
  /** Que esta mal y que hay que hacer. */
  que: string
}

const TIPOS_DE_BLOQUE = new Set(['p', 'h', 'list', 'ol', 'table', 'callout', 'rule', 'script', 'video'])

/** Minimo de preguntas por modulo (el piso que ya cumple el contenido oficial). */
export const MIN_PREGUNTAS_POR_MODULO = 3

/** Forma que debe tener el id de un curso del equipo (espejo del CHECK en BD). */
export const RE_COURSE_ID = /^eq-[a-z0-9][a-z0-9-]{1,38}$/

/**
 * Convierte un titulo en un course_id valido con prefijo obligatorio.
 * Devuelve null si no queda nada utilizable (titulo solo con simbolos).
 */
export function idDesdeTitulo(titulo: string): string | null {
  const base = titulo
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita tildes y la virgulilla, deja la letra
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 39)
    .replace(/-+$/, '')
  if (base.length < 2) return null
  const id = `eq-${base}`
  return RE_COURSE_ID.test(id) ? id : null
}

/** Forma que debe tener el id de un modulo (espejo de lo que exige validarCurso). */
export const RE_MODULE_ID = /^[a-z0-9][a-z0-9-]{0,38}$/

/**
 * Id de modulo a partir de su titulo, con desempate contra los ya usados.
 *
 * OJO: se genera UNA SOLA VEZ, al crear el modulo, y despues NO se vuelve a
 * tocar aunque le cambien el titulo. El id es la llave con la que
 * `academy_progress` recuerda quien completo que; regenerarlo al renombrar
 * borraria el avance de todo el que ya iba a la mitad, sin un solo error a la
 * vista. Por eso vive aqui y no se recalcula al vuelo en el editor.
 */
export function idDesdeTituloModulo(titulo: string, usados: Iterable<string>): string {
  const base =
    titulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 34)
      .replace(/-+$/, '') || 'modulo'
  const tomados = new Set(usados)
  let id = RE_MODULE_ID.test(base) ? base : 'modulo'
  for (let n = 2; tomados.has(id); n++) id = `${base}-${n}`
  return id
}

/** Valida una sola pregunta. `donde` ya trae el modulo al que pertenece. */
function validarPregunta(q: QuizQuestion, donde: string, n: number): ProblemaCurso[] {
  const p: ProblemaCurso[] = []
  const ubi = `${donde} / Pregunta ${n}`

  if (!q || typeof q !== 'object') {
    return [{ donde: ubi, que: 'La pregunta está vacía o malformada.' }]
  }
  if (!String(q.q ?? '').trim()) {
    p.push({ donde: ubi, que: 'Falta el enunciado de la pregunta.' })
  }
  const opts = Array.isArray(q.opts) ? q.opts.map((o) => String(o ?? '').trim()) : []
  if (opts.length < 2) {
    p.push({ donde: ubi, que: 'Hacen falta al menos 2 opciones de respuesta.' })
  }
  if (opts.some((o) => !o)) {
    p.push({ donde: ubi, que: 'Hay opciones vacías. Cada opción debe decir algo.' })
  }
  if (new Set(opts).size !== opts.length) {
    p.push({
      donde: ubi,
      que: 'Hay opciones repetidas: la respuesta correcta deja de ser única y quien elige el texto idéntico al bueno pierde el punto.',
    })
  }
  if (!Number.isInteger(q.a) || q.a < 0 || q.a >= opts.length) {
    p.push({
      donde: ubi,
      que: `La respuesta correcta apunta a la opción ${q.a}, que no existe (hay ${opts.length}). Así el quiz calificaría mal sin avisar.`,
    })
  }
  if (!String(q.ex ?? '').trim()) {
    p.push({
      donde: ubi,
      que: 'Falta la explicación. Sin ella, quien falla no aprende nada y quien acierta no sabe por qué.',
    })
  }
  return p
}

/**
 * Revisa un curso completo. Lista VACIA significa que se puede enviar a
 * revision; cualquier elemento es un motivo para no dejarlo pasar.
 *
 * Devuelve TODOS los problemas de una vez, no el primero. Corregir de uno en
 * uno, enviando y volviendo a fallar, es la forma mas rapida de que alguien
 * abandone el curso que estaba escribiendo.
 */
export function validarCurso(input: {
  title: string
  subtitle?: string
  modules: unknown
}): ProblemaCurso[] {
  const p: ProblemaCurso[] = []

  const titulo = String(input.title ?? '').trim()
  if (!titulo) p.push({ donde: 'Portada', que: 'El curso necesita un título.' })
  if (titulo.length > 120) {
    p.push({ donde: 'Portada', que: 'El título pasa de 120 caracteres.' })
  }
  if (String(input.subtitle ?? '').length > 240) {
    p.push({ donde: 'Portada', que: 'La descripción pasa de 240 caracteres.' })
  }

  const modules = Array.isArray(input.modules) ? (input.modules as Module[]) : []
  if (modules.length === 0) {
    p.push({
      donde: 'Contenido',
      que: 'El curso no tiene ningún módulo. Un curso publicado sin contenido es una promesa vacía en la biblioteca.',
    })
    return p
  }

  const idsVistos = new Set<string>()
  modules.forEach((m, i) => {
    const donde = `Módulo ${i + 1}${m?.title ? ` (${m.title})` : ''}`

    const id = String(m?.id ?? '').trim()
    if (!id) {
      p.push({
        donde,
        que: 'El módulo no tiene identificador. Sin él no hay dónde guardar el avance de quien lo estudie.',
      })
    } else if (idsVistos.has(id)) {
      p.push({
        donde,
        que: `El identificador "${id}" está repetido. Dos módulos compartirían la misma fila de progreso y uno se marcaría completo al terminar el otro.`,
      })
    } else if (!/^[a-z0-9][a-z0-9-]{0,38}$/.test(id)) {
      p.push({
        donde,
        que: `El identificador "${id}" solo admite minúsculas, números y guiones.`,
      })
    }
    idsVistos.add(id)

    if (!String(m?.title ?? '').trim()) {
      p.push({ donde, que: 'Falta el título del módulo.' })
    }

    const lessons = Array.isArray(m?.lessons) ? m.lessons : []
    if (lessons.length === 0) {
      p.push({ donde, que: 'El módulo no tiene ninguna lección.' })
    }
    lessons.forEach((l, li) => {
      const dondeL = `${donde} / Lección ${li + 1}`
      if (!String(l?.t ?? '').trim()) {
        p.push({ donde: dondeL, que: 'Falta el título de la lección.' })
      }
      const blocks = Array.isArray(l?.blocks) ? l.blocks : []
      if (blocks.length === 0) {
        p.push({ donde: dondeL, que: 'La lección está vacía.' })
      }
      blocks.forEach((b, bi) => {
        if (!b || !TIPOS_DE_BLOQUE.has(String(b.type))) {
          p.push({
            donde: `${dondeL} / Bloque ${bi + 1}`,
            que: `Tipo de bloque desconocido: "${b?.type}".`,
          })
          return
        }
        const vacio =
          b.type === 'table'
            ? !Array.isArray(b.rows) || b.rows.length === 0
            : Array.isArray(b.v)
              ? b.v.length === 0
              : !String(b.v ?? '').trim()
        if (vacio && b.type !== 'rule') {
          p.push({ donde: `${dondeL} / Bloque ${bi + 1}`, que: 'El bloque no tiene contenido.' })
        }
      })
    })

    const quiz = Array.isArray(m?.quiz) ? m.quiz : []
    if (quiz.length < MIN_PREGUNTAS_POR_MODULO) {
      p.push({
        donde,
        que: `El módulo tiene ${quiz.length} pregunta(s) y necesita al menos ${MIN_PREGUNTAS_POR_MODULO}. El avance solo se registra al aprobar el quiz: un módulo sin examen no se puede completar nunca, así que el curso jamás llegaría al 100% ni entregaría certificado.`,
      })
    }
    quiz.forEach((q, qi) => p.push(...validarPregunta(q, donde, qi + 1)))
  })

  return p
}

/**
 * Tripwire: la Academia enseña CONOCIMIENTO, no la lectura de una medición.
 *
 * EL DATO QUE LO MOTIVA. Al 2026-08-02, de 205 preguntas de quiz, unas 25 pedían
 * de vuelta la cifra de una auditoría hecha un día concreto: cuántas URLs del
 * sitemap devolvían 404 (14), cuántos ad groups estaban ENABLED (4), cuántos
 * clientes aportaba Pipedrive (2,359), cuántos artículos tenía el MSA (45). El
 * curso de SEO era el caso extremo, con 5 de 13 preguntas construidas sobre un
 * solo crawl. El curso de SEM llegó a contradecirse solo: una pregunta enseñaba
 * "antes de afirmar un conteo, consulta la cuenta viva" y la siguiente exigía
 * memorizar un conteo.
 *
 * Por qué importa: esas respuestas CADUCAN SOLAS y el certificado no. La persona
 * queda certificada por recordar un número que ya es falso, y el examen deja de
 * medir si sabe hacer el trabajo. Se convirtieron a preguntas de principio (de
 * "¿cuántas URLs devuelven 404?" a "¿por qué hay que limpiarlas?").
 *
 * Se vigilan dos cosas distintas:
 *
 *   1. QUE LA RESPUESTA CORRECTA SIGA SIENDO LA CORRECTA. Si alguien reordena o
 *      inserta una opción y no mueve el índice "a", la Academia empieza a
 *      certificar la respuesta equivocada SIN QUE NADIE SE ENTERE: no hay
 *      excepción, no hay pantalla roja, el quiz simplemente califica mal. Es un
 *      fallo silencioso, que es la clase de fallo que este repositorio persigue.
 *
 *   2. QUE LA TRIVIA NO SE VUELVA A COLAR. Trinquete: se cuentan las preguntas
 *      cuya respuesta correcta es una cifra pelada. Hoy son 9 y las 9 son
 *      legítimas (términos de contrato, montos estatutarios, estándares de
 *      planeación: cambian por firma, no por deriva). Si el número SUBE, alguien
 *      metió una medición nueva al examen y tiene que justificarlo en el diff.
 *      El tope se puede bajar cuando se limpie más, nunca subir sin motivo.
 *
 * Lee el contenido ya parseado (import), no como texto: sobre datos, un regex
 * daría la calma sin el control.
 */
import { describe, it, expect } from 'vitest'
import { COURSES } from '@/lib/academy/courses'

/** Cifra pelada: "14", "$23,000", "55%", "2.5 s", "5 años", "$25K". */
const CIFRA_PELADA = /^[~$]?[\d.,]+\s*(%|K|M|s|ms|años|año|páginas|min)?\+?$/i

/** Toda pregunta del catálogo, con su curso y módulo para poder nombrarla. */
function todasLasPreguntas() {
  return COURSES.flatMap((c) =>
    c.modules.flatMap((m) => (m.quiz ?? []).map((q) => ({ curso: c.id, modulo: m.id, q }))),
  )
}

describe('Invariante: la Academia enseña conocimiento, no la lectura de una medición', () => {
  it('el catálogo sigue teniendo contenido (defensa contra falso verde)', () => {
    // Sin esto, vaciar courses.ts pondría TODO lo de abajo en verde.
    expect(COURSES.length, 'se quedó sin cursos').toBeGreaterThanOrEqual(12)
    expect(
      todasLasPreguntas().length,
      'se desplomó el número de preguntas: o se borró contenido o el parseo dejó de funcionar',
    ).toBeGreaterThanOrEqual(200)
  })

  it('la respuesta marcada como correcta existe de verdad', () => {
    const rotas = todasLasPreguntas().filter(
      ({ q }) => !Number.isInteger(q.a) || q.a < 0 || q.a >= q.opts.length,
    )
    expect(
      rotas.map((r) => `${r.curso}/${r.modulo}: ${r.q.q}`),
      'hay preguntas cuyo índice de respuesta correcta apunta fuera de la lista de opciones: el quiz califica mal en silencio',
    ).toEqual([])
  })

  it('ninguna pregunta tiene opciones duplicadas ni vacías', () => {
    // Una opción repetida vuelve ambigua la respuesta correcta y el alumno pierde
    // por elegir un texto idéntico al bueno.
    const malas = todasLasPreguntas().filter(
      ({ q }) =>
        new Set(q.opts).size !== q.opts.length || q.opts.some((o) => !String(o).trim()),
    )
    expect(
      malas.map((r) => `${r.curso}/${r.modulo}: ${r.q.q}`),
      'hay preguntas con opciones repetidas o vacías: la respuesta correcta deja de ser única',
    ).toEqual([])
  })

  it('toda pregunta explica por qué (el examen enseña, no solo califica)', () => {
    const sinEx = todasLasPreguntas().filter(({ q }) => !q.ex || !q.ex.trim())
    expect(
      sinEx.map((r) => `${r.curso}/${r.modulo}: ${r.q.q}`),
      'hay preguntas sin explicación: quien falla no aprende nada y quien acierta no sabe por qué',
    ).toEqual([])
  })

  it('trinquete: no crece el número de preguntas que se contestan con una cifra pelada', () => {
    // Tope vivo al 2026-08-03. Las 9 que quedan son términos de contrato, montos
    // estatutarios y estándares de planeación: se saben de memoria a propósito y
    // cambian por decisión firmada, no por el paso del tiempo.
    const TOPE = 9

    const cifras = todasLasPreguntas().filter(({ q }) =>
      CIFRA_PELADA.test(String(q.opts[q.a] ?? '').trim()),
    )

    expect(
      cifras.length,
      `subió a ${cifras.length} el número de preguntas cuya respuesta correcta es una cifra pelada (tope ${TOPE}). ` +
        'Una pregunta así caduca sola mientras el certificado no: certifica a alguien por recordar la medición de un día. ' +
        'Conviértela en pregunta de principio (de "¿cuántas URLs devuelven 404?" a "¿por qué hay que limpiarlas?"), ' +
        'o si de verdad es un término de contrato o un monto de ley, sube el TOPE en este archivo y dilo en el commit. ' +
        `Preguntas actuales: ${cifras.map((c) => `${c.curso}/${c.modulo}: ${c.q.q}`).join(' | ')}`,
    ).toBeLessThanOrEqual(TOPE)
  })

  it('el curso de SEO ya no examina sobre el crawl de un solo día', () => {
    // Era el caso extremo: 5 de 13 preguntas eran lecturas de una auditoría, y es
    // justo el curso que alguien estaba esperando para poder empezar.
    const seo = COURSES.find((c) => c.id === 'seo')
    expect(seo, 'desapareció el curso de SEO').toBeTruthy()

    const cifras = (seo?.modules ?? [])
      .flatMap((m) => m.quiz ?? [])
      .filter((q) => CIFRA_PELADA.test(String(q.opts[q.a] ?? '').trim()))

    expect(
      cifras.map((q) => q.q),
      'volvieron a SEO preguntas que se contestan con la cifra de un crawl: esas respuestas son falsas al siguiente crawl y el certificado sigue vigente',
    ).toEqual([])
  })
})

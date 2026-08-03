/**
 * El flujo de vida de un curso del equipo, como DATO y no como ifs sueltos.
 *
 * POR QUE UNA TABLA. La autorizacion de esta feature entera cabe aqui: quien
 * puede hacer que, desde que estado y hacia cual. Repartida en condicionales
 * por el route handler, agregar una accion nueva obligaria a acordarse de
 * todas las reglas anteriores, y de eso no se acuerda nadie. Como tabla, una
 * accion sin fila simplemente NO EXISTE, y un tripwire puede leerla y afirmar
 * cosas sobre el sistema completo sin levantar Next ni la base.
 *
 *   draft ──enviar──> pending_review ──aprobar──> published
 *     ^                     │                        │
 *     │                     └──rechazar──> rejected ─┘ (enviar de nuevo)
 *     └──────────── retirar / reabrir ────────────────┘
 *
 * published ──archivar──> archived
 */

export type EstadoCurso =
  | 'draft'
  | 'pending_review'
  | 'published'
  | 'rejected'
  | 'archived'

export type AccionCurso =
  | 'guardar'
  | 'enviar'
  | 'retirar'
  | 'aprobar'
  | 'rechazar'
  | 'reabrir'
  | 'archivar'

export interface Transicion {
  /** Quien puede: el autor del curso, o un admin/owner de la organizacion. */
  quien: 'autor' | 'admin'
  /** Estados desde los que la accion tiene sentido. */
  desde: EstadoCurso[]
  /** Estado al que lleva. null = no cambia de estado (guardar). */
  hacia: EstadoCurso | null
  /** Si exige que el contenido pase la validacion completa. */
  validaContenido?: boolean
  /** Si exige una nota explicando la decision. */
  exigeNota?: boolean
  /** Si esta prohibido que el actor sea tambien el autor. */
  prohibeAutorrevision?: boolean
}

export const TRANSICIONES: Record<AccionCurso, Transicion> = {
  // El autor trabaja libre mientras el curso no este en manos de nadie mas.
  // Nota lo que NO esta aqui: 'published'. Un curso publicado no lo puede
  // editar su autor, porque si pudiera la aprobacion seria teatro: bastaria
  // publicar algo inocuo y cambiarlo despues. Para tocarlo, un admin lo reabre.
  guardar: { quien: 'autor', desde: ['draft', 'rejected'], hacia: null },

  // Enviar es el unico momento en que se revisa el contenido entero. Antes no:
  // un borrador a medias SIEMPRE esta incompleto y avisarlo seria ruido.
  enviar: {
    quien: 'autor',
    desde: ['draft', 'rejected'],
    hacia: 'pending_review',
    validaContenido: true,
  },

  // Arrepentirse antes de que lo revisen. Sin esto, mandarlo por error obliga a
  // pedir que lo rechacen, y queda registrado un rechazo que nunca ocurrio.
  retirar: { quien: 'autor', desde: ['pending_review'], hacia: 'draft' },

  // Se valida OTRA VEZ aunque ya se valido al enviar: esta es la escritura que
  // lo vuelve visible para todos, y entre el envio y la aprobacion pudo pasar
  // cualquier cosa.
  aprobar: {
    quien: 'admin',
    desde: ['pending_review'],
    hacia: 'published',
    validaContenido: true,
    prohibeAutorrevision: true,
  },

  // Rechazar sin decir por que es la forma mas rapida de que esa persona no
  // vuelva a escribir un curso nunca. La nota es obligatoria.
  rechazar: {
    quien: 'admin',
    desde: ['pending_review'],
    hacia: 'rejected',
    exigeNota: true,
    prohibeAutorrevision: true,
  },

  // Reabrir NO destruye nada: el progreso y los accesos viven en otras tablas y
  // siguen ahi cuando se vuelva a publicar.
  reabrir: { quien: 'admin', desde: ['published'], hacia: 'draft' },

  archivar: { quien: 'admin', desde: ['published'], hacia: 'archived' },
}

/** Motivo por el que una accion no procede, o null si procede. */
export type Veredicto =
  | { ok: true }
  | { ok: false; estado: number; error: string }

/**
 * Decide si una accion procede. Pura: no toca red ni base, asi que se puede
 * probar de verdad y no solo "por encima".
 */
export function evaluarAccion(args: {
  accion: AccionCurso
  estadoActual: EstadoCurso
  esAutor: boolean
  esAdmin: boolean
  tieneNota: boolean
}): Veredicto {
  const regla = TRANSICIONES[args.accion]
  if (!regla) return { ok: false, estado: 422, error: 'Acción desconocida' }

  const permitido = regla.quien === 'autor' ? args.esAutor : args.esAdmin
  if (!permitido) return { ok: false, estado: 403, error: 'Sin permiso para esta acción' }

  // Nadie aprueba su propio curso, ni siendo admin. La revision existe para que
  // haya un segundo par de ojos; si el autor es el revisor, no hay ninguno.
  if (regla.prohibeAutorrevision && args.esAutor) {
    return {
      ok: false,
      estado: 403,
      error: 'No puedes revisar tu propio curso. Que lo apruebe otro admin.',
    }
  }

  if (!regla.desde.includes(args.estadoActual)) {
    return {
      ok: false,
      estado: 409,
      error: `Un curso en estado "${args.estadoActual}" no admite esta acción.`,
    }
  }

  if (regla.exigeNota && !args.tieneNota) {
    return {
      ok: false,
      estado: 422,
      error: 'Hace falta explicar el motivo para que el autor pueda corregirlo.',
    }
  }

  return { ok: true }
}

/**
 * El flujo de vida de una solicitud, como DATO y no como ifs sueltos.
 *
 * Mismo patron que src/lib/academy/flujo-curso.ts, y por la misma razon: la
 * autorizacion entera de la feature cabe en una tabla (quien puede hacer que,
 * desde que estado y hacia cual). Repartida en condicionales por el route
 * handler, agregar una accion nueva obligaria a acordarse de todas las reglas
 * anteriores, y de eso no se acuerda nadie. Como tabla, una accion sin fila
 * simplemente NO EXISTE, y un tripwire puede leerla y afirmar cosas sobre el
 * sistema completo sin levantar Next ni la base.
 *
 *   solicitado ──canalizar──> canalizado ──arrancar──> en_proceso ──> resuelto
 *       │  ^                       │                        │
 *       │  └──── reabrir ──────────┴────────────────────────┘
 *       └──rechazar──> rechazado        cancelar (el solicitante) ──> cancelado
 *
 * ── Lo que este flujo NO copia del de cursos, a proposito ────────────────────
 * `prohibeAutorrevision`. Un admin SI puede canalizar su propia solicitud. En un
 * curso la revision existe para poner un segundo par de ojos sobre algo que va a
 * ver toda la organizacion; aqui la decision es de asignacion de recursos y el
 * admin es justamente quien la toma. Prohibirselo solo lograria que la pida por
 * chat, que es de donde venimos.
 */

export type EstadoSolicitud =
  | 'solicitado'
  | 'canalizado'
  | 'en_proceso'
  | 'resuelto'
  | 'rechazado'
  | 'cancelado'

export type AccionSolicitud =
  | 'editar'
  | 'canalizar'
  | 'rechazar'
  | 'arrancar'
  | 'resolver'
  | 'cancelar'
  | 'reabrir'

/** Quien puede ejecutar la accion. */
export type Actor =
  /** Quien levanto la solicitud. */
  | 'solicitante'
  /** Quien quedo a cargo. Un admin siempre cuenta como responsable tambien. */
  | 'responsable'
  /** Mando de la organizacion o del workspace. */
  | 'admin'

export interface TransicionSolicitud {
  quien: Actor
  /** Estados desde los que la accion tiene sentido. */
  desde: EstadoSolicitud[]
  /** Estado al que lleva. null = no cambia de estado (editar). */
  hacia: EstadoSolicitud | null
  /** Si exige una nota explicando la decision. */
  exigeNota?: boolean
  /** Si exige que la solicitud quede con destino (departamento o responsable). */
  exigeDestino?: boolean
  /** Si al ejecutarla la solicitud queda cerrada (closed_at). */
  cierra?: boolean
}

export const TRANSICIONES: Record<AccionSolicitud, TransicionSolicitud> = {
  // Corregir lo que se pidio, mientras nadie haya decidido nada todavia. Una vez
  // canalizada NO se edita: quien ya se comprometio a hacer algo se comprometio
  // a hacer ESO, y cambiarle el enunciado por debajo es como se generan
  // entregables que no eran los pedidos. Para cambiarlo, se comenta en el hilo.
  editar: { quien: 'solicitante', desde: ['solicitado'], hacia: null },

  // El acto central del modulo. Exige destino porque una solicitud "aceptada"
  // que no dice a quien le toca es exactamente igual de inutil que una ignorada,
  // solo que ademas parece atendida.
  canalizar: {
    quien: 'admin',
    desde: ['solicitado', 'rechazado', 'cancelado'],
    hacia: 'canalizado',
    exigeDestino: true,
  },

  // Rechazar sin decir por que es la forma mas rapida de que esa persona no
  // vuelva a pedir nada, y de que el problema siga existiendo sin que nadie se
  // entere. La nota es obligatoria. (La misma leccion que en cursos.)
  rechazar: {
    quien: 'admin',
    desde: ['solicitado', 'canalizado', 'en_proceso'],
    hacia: 'rechazado',
    exigeNota: true,
    cierra: true,
  },

  // Lo agarra quien quedo a cargo. Existe como paso propio porque la diferencia
  // entre "me lo asignaron" y "ya estoy en eso" es la unica señal temprana de
  // que algo lleva tres semanas parado.
  arrancar: { quien: 'responsable', desde: ['canalizado'], hacia: 'en_proceso' },

  // Cerrar exige decir que se hizo. Un "resuelto" pelado obliga al solicitante a
  // ir a verificar por su cuenta, que es medio trabajo repetido.
  resolver: {
    quien: 'responsable',
    desde: ['canalizado', 'en_proceso'],
    hacia: 'resuelto',
    exigeNota: true,
    cierra: true,
  },

  // Arrepentirse. Deja rastro a proposito: borrar la solicitud haria que el
  // historial fuera opcional, y un historial opcional no es un historial.
  cancelar: {
    quien: 'solicitante',
    desde: ['solicitado', 'canalizado', 'en_proceso'],
    hacia: 'cancelado',
    cierra: true,
  },

  // Volver a abrir algo que se cerro mal. Lo puede el solicitante porque es
  // quien sabe si de verdad quedo resuelto; nadie mas esta en posicion de
  // decirlo. Regresa a 'solicitado' y no a 'en_proceso': si se cerro por error,
  // la decision hay que volver a tomarla.
  reabrir: {
    quien: 'solicitante',
    desde: ['resuelto', 'rechazado', 'cancelado'],
    hacia: 'solicitado',
    exigeNota: true,
  },
}

export type Veredicto = { ok: true } | { ok: false; estado: number; error: string }

/**
 * Decide si una accion procede. Pura: no toca red ni base, asi que se puede
 * probar de verdad y no solo "por encima".
 */
export function evaluarAccion(args: {
  accion: AccionSolicitud
  estadoActual: EstadoSolicitud
  esSolicitante: boolean
  esResponsable: boolean
  esAdmin: boolean
  tieneNota: boolean
  /** Quedara con departamento o con responsable despues de esta accion. */
  tieneDestino: boolean
}): Veredicto {
  const regla = TRANSICIONES[args.accion]
  if (!regla) return { ok: false, estado: 422, error: 'Acción desconocida' }

  // El admin puede todo lo que puede el responsable: es quien destraba cuando la
  // persona a cargo se fue de vacaciones. Lo que NO se le regala es el papel de
  // solicitante, porque cancelar o reabrir lo ajeno no es destrabar, es decidir
  // por otro si su problema ya quedo resuelto.
  const permitido =
    regla.quien === 'admin'
      ? args.esAdmin
      : regla.quien === 'responsable'
        ? args.esResponsable || args.esAdmin
        : args.esSolicitante

  if (!permitido) return { ok: false, estado: 403, error: 'Sin permiso para esta acción' }

  if (!regla.desde.includes(args.estadoActual)) {
    return {
      ok: false,
      estado: 409,
      error: `Una solicitud en estado "${args.estadoActual}" no admite esta acción.`,
    }
  }

  if (regla.exigeDestino && !args.tieneDestino) {
    return {
      ok: false,
      estado: 422,
      error: 'Para canalizar hace falta decir a qué departamento va o quién queda a cargo.',
    }
  }

  if (regla.exigeNota && !args.tieneNota) {
    return {
      ok: false,
      estado: 422,
      error: 'Hace falta escribir el motivo. Sin él, quien la pidió no sabe qué pasó.',
    }
  }

  return { ok: true }
}

/** Estados en los que la solicitud ya no espera nada de nadie. */
export const ESTADOS_CERRADOS: EstadoSolicitud[] = ['resuelto', 'rechazado', 'cancelado']

export function estaCerrada(estado: EstadoSolicitud): boolean {
  return ESTADOS_CERRADOS.includes(estado)
}

/**
 * Semaforo de AVANCE de una tarea, para los cronogramas.
 *
 * Colorear por prioridad contesta "que tan importante es" y colorear por estado
 * contesta "en que columna esta". Ninguna de las dos contesta la pregunta que de
 * verdad se hace quien abre un Gantt un lunes: "que deberia estar corriendo y no
 * arranco". Una tarea en estado inicial cuyo dia de inicio YA PASO es un atraso
 * silencioso: no aparece como vencida (su entrega todavia no llega) y en el
 * cronograma se pinta igual que una tarea que apenas va a empezar la semana que
 * viene. Este modo las separa.
 *
 * El universo real de categorias en la app es todo, in_progress, done y
 * cancelled (no existen backlog ni unstarted). Cualquier categoria desconocida
 * cae en el cubo inicial a proposito: es preferible marcar de mas que esconder.
 */
export type Avance = 'sin_empezar' | 'no_arranco' | 'en_curso' | 'terminada' | 'cancelada'

/**
 * Rojo solo para el atraso real. El gris del "sin empezar" es deliberado: una
 * tarea que arranca en tres semanas no es un problema y no debe competir por la
 * atencion con la que ya se paso de fecha.
 */
export const AVANCE_COLOR: Record<Avance, string> = {
  sin_empezar: '#94a3b8',
  no_arranco: '#ef4444',
  en_curso: '#3b82f6',
  terminada: '#22c55e',
  cancelada: '#64748b',
}

export const AVANCE_LABEL_KEY: Record<Avance, string> = {
  sin_empezar: 'gantt.avanceSinEmpezar',
  no_arranco: 'gantt.avanceNoArranco',
  en_curso: 'gantt.avanceEnCurso',
  terminada: 'gantt.avanceTerminada',
  cancelada: 'gantt.avanceCancelada',
}

/** Orden de la leyenda: primero lo que exige una decision. */
export const AVANCE_ORDER: Avance[] = ['no_arranco', 'en_curso', 'sin_empezar', 'terminada', 'cancelada']

/**
 * `start` y `today` deben venir normalizados a medianoche LOCAL (startOfDay),
 * igual que el resto de la aritmetica de dias de los cronogramas. Si el inicio
 * es hoy mismo NO cuenta como atraso: la jornada todavia no termina.
 */
export function avanceDe(category: string | null | undefined, start: Date, today: Date): Avance {
  if (category === 'done') return 'terminada'
  if (category === 'cancelled') return 'cancelada'
  if (category === 'in_progress') return 'en_curso'
  return start.getTime() < today.getTime() ? 'no_arranco' : 'sin_empezar'
}

/** Las que no arrancaron se pintan huecas y rayadas, no solo de otro color. */
export function avanceIsHollow(a: Avance): boolean {
  return a === 'sin_empezar' || a === 'no_arranco'
}

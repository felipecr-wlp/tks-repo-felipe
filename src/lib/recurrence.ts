/**
 * Helpers de tareas recurrentes (Circuito B26).
 *
 * Una tarea con recurrence_rule genera automaticamente su siguiente
 * ocurrencia cuando se marca como completada (categoria de estado 'done'),
 * ver PATCH /api/tasks/[taskId]. recurrence_end_date es el limite opcional:
 * si la proxima fecha calculada lo supera, la serie no continua.
 */

export const RECURRENCE_RULES = ['daily', 'weekly', 'biweekly', 'monthly'] as const
export type RecurrenceRule = (typeof RECURRENCE_RULES)[number]

export const RECURRENCE_LABELS: Record<RecurrenceRule, string> = {
  daily:    'Cada dia',
  weekly:   'Cada semana',
  biweekly: 'Cada 2 semanas',
  monthly:  'Cada mes',
}

/** Calcula la proxima fecha a partir de `from`, segun la regla. */
export function nextRecurrenceDate(rule: RecurrenceRule, from: Date): Date {
  const d = new Date(from)
  switch (rule) {
    case 'daily':    d.setDate(d.getDate() + 1); break
    case 'weekly':   d.setDate(d.getDate() + 7); break
    case 'biweekly': d.setDate(d.getDate() + 14); break
    case 'monthly':  addMonthClamped(d, 1); break
  }
  return d
}

/**
 * Avanza `d` en `months` meses SIN desbordar el fin de mes. `setMonth` nativo
 * hace rollover (ej. 31 ene + 1 mes intenta 31 feb y salta a 3 mar); aqui se
 * fija primero el dia 1, se avanza el mes y luego se re-aplica el dia original
 * acotado al ultimo dia del mes destino (31 ene -> 28/29 feb). Muta `d`.
 */
function addMonthClamped(d: Date, months: number): void {
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
}

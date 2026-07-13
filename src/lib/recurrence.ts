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
    case 'monthly':  d.setMonth(d.getMonth() + 1); break
  }
  return d
}

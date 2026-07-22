/**
 * Tests de nextRecurrenceDate: fija la regla de fin de mes.
 *
 * El bug historico: setMonth(getMonth()+1) sobre el 31 de enero intentaba el
 * "31 de febrero" y JS lo desbordaba al 2/3 de marzo, saltandose febrero. La
 * regla correcta acota el dia al ultimo dia valido del mes destino.
 */
import { describe, it, expect } from 'vitest'
import { nextRecurrenceDate } from '@/lib/recurrence'

// Construye una fecha local a mediodia para evitar corrimientos por zona horaria.
function d(y: number, m: number, day: number) { return new Date(y, m - 1, day, 12, 0, 0) }

describe('nextRecurrenceDate', () => {
  it('daily suma un dia', () => {
    expect(nextRecurrenceDate('daily', d(2026, 1, 10)).getDate()).toBe(11)
  })

  it('weekly suma 7 dias', () => {
    const r = nextRecurrenceDate('weekly', d(2026, 1, 10))
    expect(r.getMonth()).toBe(0)
    expect(r.getDate()).toBe(17)
  })

  it('biweekly suma 14 dias', () => {
    const r = nextRecurrenceDate('biweekly', d(2026, 1, 10))
    expect(r.getDate()).toBe(24)
  })

  it('monthly desde el 15 avanza al 15 del mes siguiente', () => {
    const r = nextRecurrenceDate('monthly', d(2026, 1, 15))
    expect(r.getMonth()).toBe(1) // febrero
    expect(r.getDate()).toBe(15)
  })

  it('monthly desde el 31 de enero NO desborda: cae en el 28 de febrero (2026 no bisiesto)', () => {
    const r = nextRecurrenceDate('monthly', d(2026, 1, 31))
    expect(r.getMonth()).toBe(1) // febrero, no marzo
    expect(r.getDate()).toBe(28)
  })

  it('monthly desde el 31 de enero de un ano bisiesto cae en el 29 de febrero', () => {
    const r = nextRecurrenceDate('monthly', d(2028, 1, 31))
    expect(r.getMonth()).toBe(1)
    expect(r.getDate()).toBe(29)
  })

  it('monthly desde el 31 de marzo cae en el 30 de abril', () => {
    const r = nextRecurrenceDate('monthly', d(2026, 3, 31))
    expect(r.getMonth()).toBe(3) // abril
    expect(r.getDate()).toBe(30)
  })
})

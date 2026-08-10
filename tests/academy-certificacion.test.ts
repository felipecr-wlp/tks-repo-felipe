/**
 * Certificacion: acuse, firma del supervisor y vigencia.
 *
 * Aqui la pregunta no es "¿tomo el curso?" sino "¿lo tiene VIGENTE hoy?". Los
 * dos errores que importan son simetricos y los dos son caros:
 *
 *   - Reportar VIGENTE a alguien vencido: se manda a una persona a un trabajo
 *     con la capacitacion caducada, y delante de un auditor es justo el dato
 *     que vienen a buscar.
 *   - Reportar VENCIDO a alguien que no lo esta: se para a alguien sin motivo
 *     y se le pierde la confianza al sistema.
 *
 * El "ahora" se inyecta en vez de usar el reloj: si dependiera de la fecha de
 * la maquina, estas pruebas empezarian a fallar solas algun dia y nadie sabria
 * si fue el codigo o el calendario.
 */
import { describe, it, expect } from 'vitest'
import {
  estadoCertificacion,
  calcularVencimiento,
  diasHasta,
  estaCertificado,
  proximosAVencer,
  DIAS_AVISO_VENCIMIENTO,
  type Certificacion,
  type RequisitosItem,
} from '@/lib/academy/certificacion'

const AHORA = new Date('2026-08-10T12:00:00Z')

const cert = (x: Partial<Certificacion> = {}): Certificacion => ({
  profile_id: 'p1', item_type: 'video', item_id: 'v1',
  acknowledged_at: null, verified_at: null, verified_by: null, expires_at: null,
  ...x,
})

const req = (x: Partial<RequisitosItem> = {}): RequisitosItem => ({
  requires_ack: false, requires_verification: false, valid_months: null, ...x,
})

describe('Estado: vigente, vencida y todo lo de en medio', () => {
  it('haber visto el video basta cuando no se exige nada mas', () => {
    expect(estadoCertificacion(null, req(), true, AHORA)).toBe('vigente')
  })

  it('sin verlo no hay certificacion', () => {
    expect(estadoCertificacion(null, req(), false, AHORA)).toBe('pendiente')
  })

  it('si se exige acuse y no lo dio, sigue pendiente', () => {
    expect(estadoCertificacion(null, req({ requires_ack: true }), true, AHORA)).toBe('pendiente')
  })

  it('con acuse pero esperando firma del supervisor, se distingue de pendiente', () => {
    // Importa la diferencia: "pendiente" es tarea de la persona, "espera
    // verificacion" es tarea del supervisor. Mezclarlos hace que nadie sepa a
    // quien apurar.
    const c = cert({ acknowledged_at: '2026-08-01T00:00:00Z' })
    const r = req({ requires_ack: true, requires_verification: true })
    expect(estadoCertificacion(c, r, true, AHORA)).toBe('espera_verificacion')
  })

  it('con acuse y firma queda vigente', () => {
    const c = cert({ acknowledged_at: '2026-08-01T00:00:00Z', verified_at: '2026-08-02T00:00:00Z' })
    const r = req({ requires_ack: true, requires_verification: true })
    expect(estadoCertificacion(c, r, true, AHORA)).toBe('vigente')
  })
})

describe('Vencimiento: el dato que pide el auditor', () => {
  it('VENCIDA gana sobre todo, aunque tenga acuse y firma', () => {
    // Este es EL caso. Con cualquier otro orden de evaluacion, alguien con la
    // capacitacion caducada saldria reportado como vigente.
    const c = cert({
      acknowledged_at: '2025-01-01T00:00:00Z',
      verified_at: '2025-01-02T00:00:00Z',
      expires_at: '2026-01-01T00:00:00Z',
    })
    const r = req({ requires_ack: true, requires_verification: true })
    expect(estadoCertificacion(c, r, true, AHORA)).toBe('vencida')
  })

  it('vencida gana TAMBIÉN cuando además falta la firma', () => {
    // Este es el caso que de verdad prueba el ORDEN de evaluación, y el que
    // faltaba: con el chequeo de vencimiento al final, alguien cuya
    // certificación caducó Y nunca fue verificada saldría como
    // "espera_verificacion", o sea como si nunca hubiera estado certificado.
    // La diferencia importa para quien lee el reporte: "vencida" dice que
    // ESTUVO vigente y hay que recertificar; "espera_verificacion" manda a
    // buscar a un supervisor que ya firmó una vez.
    const c = cert({
      acknowledged_at: '2025-01-01T00:00:00Z',
      verified_at: null,
      expires_at: '2026-01-01T00:00:00Z',
    })
    const r = req({ requires_ack: true, requires_verification: true })
    expect(estadoCertificacion(c, r, true, AHORA)).toBe('vencida')
  })

  it('vencida gana incluso si la persona ya no aparece como "vista"', () => {
    // Sin el chequeo primero esto daria 'pendiente', que borra el hecho de
    // que la persona SI estuvo certificada y se le vencio.
    const c = cert({ expires_at: '2026-01-01T00:00:00Z' })
    expect(estadoCertificacion(c, req(), false, AHORA)).toBe('vencida')
  })

  it('vencida NO cuenta como certificado', () => {
    expect(estaCertificado('vencida')).toBe(false)
    expect(estaCertificado('espera_verificacion')).toBe(false)
    expect(estaCertificado('vigente')).toBe(true)
    // Por vencer SIGUE valiendo: avisar no es revocar.
    expect(estaCertificado('por_vencer')).toBe(true)
  })

  it('avisa dentro de la ventana y no antes', () => {
    const dentro = cert({ expires_at: '2026-09-01T12:00:00Z' }) // 22 dias
    const lejos = cert({ expires_at: '2026-12-01T12:00:00Z' })
    expect(estadoCertificacion(dentro, req(), true, AHORA)).toBe('por_vencer')
    expect(estadoCertificacion(lejos, req(), true, AHORA)).toBe('vigente')
  })

  it('el borde exacto de la ventana avisa', () => {
    const justo = new Date(AHORA.getTime() + DIAS_AVISO_VENCIMIENTO * 86400000)
    const c = cert({ expires_at: justo.toISOString() })
    expect(estadoCertificacion(c, req(), true, AHORA)).toBe('por_vencer')
  })
})

describe('Cálculo de la fecha de vencimiento', () => {
  it('suma MESES de calendario, no 30 días', () => {
    // "Vigente un año" tiene que caer el mismo dia del año siguiente. Con
    // 12 x 30 dias caeria 5 dias antes y la gente perderia vigencia sin motivo.
    const r = calcularVencimiento(new Date('2026-08-10T12:00:00Z'), 12)
    expect(r?.toISOString().slice(0, 10)).toBe('2027-08-10')
  })

  it('un día que no existe en el mes destino cae al último día, no se desborda', () => {
    // 31 de enero + 1 mes: JS daria 2 o 3 de marzo. Eso adelanta el
    // vencimiento a un mes que no es, y nadie entiende la fecha que ve.
    const r = calcularVencimiento(new Date('2026-01-31T12:00:00Z'), 1)
    expect(r?.toISOString().slice(0, 10)).toBe('2026-02-28')
  })

  it('sin meses no caduca', () => {
    expect(calcularVencimiento(AHORA, null)).toBeNull()
    expect(calcularVencimiento(AHORA, 0)).toBeNull()
  })

  it('los días restantes se redondean a favor de la persona', () => {
    // 30 dias y 1 hora son 31 dias de calendario: redondear hacia abajo
    // adelantaria el aviso y haria que "30 dias" significara 29.
    const fecha = new Date(AHORA.getTime() + 30 * 86400000 + 3600000).toISOString()
    expect(diasHasta(fecha, AHORA)).toBe(31)
  })

  it('lo ya vencido da días negativos', () => {
    expect(diasHasta('2026-08-01T12:00:00Z', AHORA)).toBe(-9)
  })
})

describe('Reporte de recertificación', () => {
  const fila = (nombre: string, expires_at: string | null) => ({
    ...cert({ expires_at }), nombre, titulo: 'Seguridad',
  })

  it('lo vencido va primero, luego lo más próximo', () => {
    const r = proximosAVencer([
      fila('Ana', '2026-08-25T12:00:00Z'),   // 15 dias
      fila('Beto', '2026-08-01T12:00:00Z'),  // vencido
      fila('Caro', '2026-08-15T12:00:00Z'),  // 5 dias
    ], AHORA)
    expect(r.map((x) => x.nombre)).toEqual(['Beto', 'Caro', 'Ana'])
    expect(r[0].diasRestantes).toBeLessThan(0)
  })

  it('lo que no caduca y lo lejano no entran al reporte', () => {
    const r = proximosAVencer([
      fila('Sin fecha', null),
      fila('Lejos', '2027-01-01T12:00:00Z'),
    ], AHORA)
    expect(r).toEqual([])
  })
})

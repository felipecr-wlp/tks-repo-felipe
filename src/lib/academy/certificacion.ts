/**
 * Certificacion: acuse de la persona, firma del supervisor y VIGENCIA.
 *
 * La pregunta que contesta este modulo no es "¿tomo el curso?" sino "¿lo tiene
 * VIGENTE hoy?", que es lo unico que sirve delante de un auditor y lo unico que
 * evita mandar a alguien a un trabajo con la capacitacion vencida.
 *
 * Logica pura y sin red a proposito: las reglas de fecha son donde se cuelan
 * los errores de un dia, y aqui se pueden probar contra un "ahora" fijo en vez
 * de contra el reloj de la maquina.
 */

/** Aviso con este tanto de anticipacion: da tiempo a agendar la recertificacion. */
export const DIAS_AVISO_VENCIMIENTO = 30

export type EstadoCertificacion =
  /** No ha empezado o no cumple los requisitos. */
  | 'pendiente'
  /** Cumplio lo suyo; falta que un supervisor firme. */
  | 'espera_verificacion'
  /** Vigente. */
  | 'vigente'
  /** Vigente pero se vence pronto. */
  | 'por_vencer'
  /** Se vencio: cuenta como NO certificado. */
  | 'vencida'

export interface Certificacion {
  profile_id: string
  item_type: 'course' | 'video'
  item_id: string
  acknowledged_at: string | null
  verified_at: string | null
  verified_by: string | null
  expires_at: string | null
}

export interface RequisitosItem {
  requires_ack: boolean
  requires_verification: boolean
  /** Meses de vigencia. null = no caduca. */
  valid_months: number | null
}

/**
 * Estado de una certificacion en un instante dado.
 *
 * @param cert   la fila, o null si la persona no tiene ninguna
 * @param req    que exige este contenido
 * @param visto  si la persona ya completo el contenido (vio el video / pasó el quiz)
 * @param ahora  el instante de referencia. Se inyecta para poder probarlo.
 */
export function estadoCertificacion(
  cert: Certificacion | null,
  req: RequisitosItem,
  visto: boolean,
  ahora: Date,
): EstadoCertificacion {
  // VENCIDA GANA SOBRE TODO. Se evalua primero a proposito: una fila con
  // acuse y firma pero con la fecha pasada NO esta certificada, y cualquier
  // otro orden acabaria reportando como vigente a alguien vencido, que es
  // justo el dato que un auditor viene a buscar.
  if (cert?.expires_at && new Date(cert.expires_at).getTime() <= ahora.getTime()) {
    return 'vencida'
  }

  if (!visto) return 'pendiente'
  if (req.requires_ack && !cert?.acknowledged_at) return 'pendiente'
  if (req.requires_verification && !cert?.verified_at) return 'espera_verificacion'

  if (cert?.expires_at) {
    const faltan = diasHasta(cert.expires_at, ahora)
    if (faltan <= DIAS_AVISO_VENCIMIENTO) return 'por_vencer'
  }
  return 'vigente'
}

/** Dias entre `ahora` y una fecha ISO. Negativo si ya paso. */
export function diasHasta(iso: string, ahora: Date): number {
  const ms = new Date(iso).getTime() - ahora.getTime()
  // Se redondea hacia ARRIBA: si faltan 30 dias y 1 hora, la persona todavia
  // tiene 31 dias de calendario. Redondear hacia abajo adelantaria el aviso
  // un dia y haria que "30 dias" significara 29.
  return Math.ceil(ms / 86_400_000)
}

/**
 * Fecha de vencimiento a partir de la firma.
 *
 * Se suman MESES de calendario, no 30 dias: "vigente un año" tiene que caer el
 * mismo dia del año siguiente, no 5 dias antes. Si el dia no existe en el mes
 * destino (31 de enero + 1 mes), JS desborda a marzo; se corrige al ULTIMO dia
 * del mes destino, que es lo que espera cualquiera que lea la fecha.
 */
export function calcularVencimiento(desde: Date, meses: number | null): Date | null {
  if (meses === null || meses <= 0) return null
  const d = new Date(desde.getTime())
  const diaOriginal = d.getDate()
  d.setMonth(d.getMonth() + meses)
  if (d.getDate() !== diaOriginal) {
    // Desbordo de mes: retroceder al ultimo dia del mes anterior.
    d.setDate(0)
  }
  return d
}

/** true si el estado cuenta como certificado para operar. */
export function estaCertificado(e: EstadoCertificacion): boolean {
  return e === 'vigente' || e === 'por_vencer'
}

export interface FilaVencimiento {
  profileId: string
  nombre: string
  itemId: string
  titulo: string
  expiresAt: string
  diasRestantes: number
}

/**
 * Quien tiene algo por vencer o vencido, lo mas urgente primero. Es el reporte
 * que de verdad se usa: no "quien tomo el curso", sino "a quien hay que
 * recertificar antes de que se le venza".
 */
export function proximosAVencer(
  certs: readonly (Certificacion & { nombre: string; titulo: string })[],
  ahora: Date,
  dentroDeDias = DIAS_AVISO_VENCIMIENTO,
): FilaVencimiento[] {
  const out: FilaVencimiento[] = []
  for (const c of certs) {
    if (!c.expires_at) continue
    const dias = diasHasta(c.expires_at, ahora)
    if (dias > dentroDeDias) continue
    out.push({
      profileId: c.profile_id,
      nombre: c.nombre,
      itemId: c.item_id,
      titulo: c.titulo,
      expiresAt: c.expires_at,
      diasRestantes: dias,
    })
  }
  // Lo ya vencido primero (dias negativos), luego lo mas proximo.
  return out.sort((a, b) => a.diasRestantes - b.diasRestantes)
}

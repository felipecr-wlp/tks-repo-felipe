/**
 * Reporte diario de actividades: reglas compartidas por KERN, la pantalla y el
 * cron. Vive en un solo archivo para que las tres bocas cuenten el mismo dia.
 *
 * El problema que resuelve: la gente narra su jornada a pedazos y a deshoras.
 * Si cada capa calcula "hoy" con `new Date()` del servidor (UTC en Vercel), lo
 * que alguien escribe a las 6 de la tarde en Mexico se archiva en el dia
 * siguiente. Aqui se fija UNA zona horaria y todos preguntan por ella.
 */

/**
 * Zona horaria del dia laboral. Punto unico de cambio.
 *
 * No sale de la base porque `workspaces` no guarda zona y agregarle una columna
 * para un solo valor real seria ceremonia. Si algun dia hay equipos en husos
 * distintos, esta constante es lo que se convierte en columna.
 */
export const REPORT_TIMEZONE = 'America/Mexico_City'

/** Categorias de lo que se narra. El orden es el que se muestra. */
export const REPORT_CATEGORIES = ['avance', 'bloqueo', 'siguiente', 'nota'] as const
export type ReportCategory = (typeof REPORT_CATEGORIES)[number]

export const CATEGORY_LABEL: Record<ReportCategory, string> = {
  avance: 'Avance',
  bloqueo: 'Bloqueo',
  siguiente: 'Siguiente',
  nota: 'Nota',
}

/**
 * Descripcion para el modelo. Se inyecta en la herramienta de KERN para que
 * clasifique solo, en vez de preguntarle a la persona en que cajon va lo que
 * acaba de contar.
 */
export const CATEGORY_HINT =
  'avance = algo que ya hizo o avanzo. bloqueo = algo que lo detiene y necesita a alguien mas. ' +
  'siguiente = lo que hara despues. nota = contexto o comentario suelto.'

/** Fecha (YYYY-MM-DD) del dia laboral en curso segun REPORT_TIMEZONE. */
export function todayInReportTz(now: Date = new Date()): string {
  // 'en-CA' formatea como YYYY-MM-DD, que es justo el literal que espera una
  // columna `date` de Postgres. Evita construir la cadena a mano y equivocarse
  // con el mes base cero.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

/** Suma (o resta) dias a una fecha YYYY-MM-DD sin tocar zonas horarias. */
export function shiftDate(date: string, days: number): string {
  // Se ancla a mediodia UTC: sumar dias desde medianoche puede cruzar el limite
  // por el horario de verano y devolver el mismo dia o saltarse uno.
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** ¿Es una fecha YYYY-MM-DD valida? Guarda de entrada para rutas y herramientas. */
export function isValidReportDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const d = new Date(`${value}T12:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value
}

/** "martes 29 de julio" para encabezados. */
export function formatReportDate(date: string, opts?: { withYear?: boolean }): string {
  const d = new Date(`${date}T12:00:00Z`)
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'UTC',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(opts?.withYear ? { year: 'numeric' } : {}),
  }).format(d)
}

/** Hora local ("14:35") de una marca de tiempo, para la linea de tiempo del dia. */
export function formatReportTime(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: REPORT_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso))
}

/** Sabado o domingo. Se usa para no molestar con recordatorios en fin de semana. */
export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

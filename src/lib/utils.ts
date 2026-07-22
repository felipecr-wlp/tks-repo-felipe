/**
 * Utilidades globales del proyecto
 */
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { format, formatDistanceToNow, isToday, isTomorrow, isPast } from 'date-fns'
import { es } from 'date-fns/locale'

/** Combina clases de Tailwind sin conflictos */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Genera un slug URL-safe desde un nombre */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remover acentos
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

/** Formatea una fecha para mostrar en la UI */
export function formatDate(date: string | Date | null): string {
  if (!date) return ''
  const d = new Date(date)
  if (isToday(d)) return 'Hoy'
  if (isTomorrow(d)) return 'Mañana'
  return format(d, "d MMM yyyy", { locale: es })
}

/** Fecha relativa (ej: "hace 2 horas") */
export function timeAgo(date: string | Date): string {
  return formatDistanceToNow(new Date(date), { locale: es, addSuffix: true })
}

/** Verifica si una fecha ya pasó */
export function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false
  return isPast(new Date(dueDate))
}

/**
 * Convierte un valor de <input type="date"> (YYYY-MM-DD) en un timestamp ISO
 * anclado al MEDIODIA local. Anclar a las 12:00 evita que el desfase de zona
 * horaria (ej. Mexico UTC-6) cruce el limite del dia al serializar a UTC.
 * Ejemplo (UTC-6): '2026-07-21' -> 2026-07-21T12:00:00-06:00 -> ...T18:00:00Z,
 * que sigue siendo el dia 21 tanto en local como en UTC. Devuelve null si el
 * valor esta vacio o mal formado.
 */
export function dateInputToISO(value: string | null | undefined): string | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
  if (!m) return null
  const [, y, mo, d] = m
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), 12, 0, 0, 0)
  if (Number.isNaN(dt.getTime())) return null
  return dt.toISOString()
}

/**
 * Formatea un timestamp almacenado (timestamptz) al valor YYYY-MM-DD que espera
 * un <input type="date">, usando las partes de fecha LOCALES (no las de UTC).
 * Asi el dia mostrado coincide con el dia que el usuario eligio. Devuelve ''
 * si la fecha es nula o invalida.
 */
export function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const y = d.getFullYear()
  const mo = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

/** Genera iniciales para avatar fallback */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

/** Formatea bytes a string legible */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

/** Colores para prioridades */
export const PRIORITY_COLORS = {
  none:   { bg: 'bg-gray-100',   text: 'text-gray-500',   label: 'Sin prioridad' },
  low:    { bg: 'bg-blue-100',   text: 'text-blue-600',   label: 'Baja' },
  medium: { bg: 'bg-yellow-100', text: 'text-yellow-600', label: 'Media' },
  high:   { bg: 'bg-orange-100', text: 'text-orange-600', label: 'Alta' },
  urgent: { bg: 'bg-red-100',    text: 'text-red-600',    label: 'Urgente' },
} as const

/** Colores para categorías de status */
export const STATUS_CATEGORY_COLORS = {
  todo:        '#6B7280',
  in_progress: '#3B82F6',
  done:        '#10B981',
  cancelled:   '#EF4444',
} as const

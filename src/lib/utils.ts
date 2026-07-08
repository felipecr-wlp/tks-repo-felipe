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

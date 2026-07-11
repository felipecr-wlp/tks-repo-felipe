/**
 * Registro compartido de iconos de nota (lucide, sin emojis).
 *
 * El campo `notes.icon` guarda una CLAVE estable (ej. 'target'), no un emoji.
 * Render centralizado en <NoteIcon /> para que todas las superficies (arbol,
 * editor, breadcrumb, plantillas) se vean igual.
 *
 * Compatibilidad: las notas viejas que aun tengan un emoji guardado se mapean a
 * su icono equivalente via LEGACY_EMOJI_MAP, asi que NO hace falta migrar la base
 * de datos: la conversion ocurre en la capa de render y las notas nuevas ya
 * guardan la clave.
 */
import {
  FileText,
  ClipboardList,
  Target,
  CalendarDays,
  BookOpen,
  Scale,
  Lightbulb,
  Rocket,
  Star,
  Flame,
  Palette,
  Wrench,
  BarChart3,
  GraduationCap,
  Folder,
  type LucideIcon,
} from 'lucide-react'

// Orden en el que se muestran en el selector del editor.
export const NOTE_ICONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: 'file', label: 'Documento', Icon: FileText },
  { key: 'clipboard', label: 'Procedimiento', Icon: ClipboardList },
  { key: 'target', label: 'Objetivo', Icon: Target },
  { key: 'calendar', label: 'Reunión', Icon: CalendarDays },
  { key: 'books', label: 'Wiki', Icon: BookOpen },
  { key: 'scale', label: 'Decisión', Icon: Scale },
  { key: 'lightbulb', label: 'Idea', Icon: Lightbulb },
  { key: 'rocket', label: 'Lanzamiento', Icon: Rocket },
  { key: 'star', label: 'Destacado', Icon: Star },
  { key: 'flame', label: 'Urgente', Icon: Flame },
  { key: 'palette', label: 'Diseño', Icon: Palette },
  { key: 'tools', label: 'Herramientas', Icon: Wrench },
  { key: 'chart', label: 'Métricas', Icon: BarChart3 },
  { key: 'graduation', label: 'Aprendizaje', Icon: GraduationCap },
  { key: 'folder', label: 'Carpeta', Icon: Folder },
]

export const DEFAULT_NOTE_ICON = 'file'

const ICON_MAP = new Map(NOTE_ICONS.map(i => [i.key, i.Icon]))

// Mapa de compatibilidad: emojis de notas antiguas -> clave estable.
const LEGACY_EMOJI_MAP: Record<string, string> = {
  '📄': 'file',
  '📋': 'clipboard',
  '🎯': 'target',
  '🗓️': 'calendar',
  '🗓': 'calendar',
  '📚': 'books',
  '⚖️': 'scale',
  '⚖': 'scale',
  '💡': 'lightbulb',
  '🚀': 'rocket',
  '⭐': 'star',
  '🔥': 'flame',
  '🎨': 'palette',
  '🛠️': 'tools',
  '🛠': 'tools',
  '📊': 'chart',
  '🎓': 'graduation',
  '📁': 'folder',
}

/** Normaliza un valor guardado (clave nueva o emoji viejo) a una clave del registro. */
export function normalizeNoteIconKey(value: string | null | undefined): string {
  if (!value) return DEFAULT_NOTE_ICON
  if (ICON_MAP.has(value)) return value
  return LEGACY_EMOJI_MAP[value] ?? DEFAULT_NOTE_ICON
}

/** Devuelve el componente lucide para un valor guardado, cayendo al icono por defecto. */
export function noteIconFor(value: string | null | undefined): LucideIcon {
  return ICON_MAP.get(normalizeNoteIconKey(value)) ?? FileText
}

/** Render de icono de nota por valor guardado (clave o emoji legado). */
export function NoteIcon({
  icon,
  size = 16,
  className,
}: {
  icon: string | null | undefined
  size?: number
  className?: string
}) {
  const Icon = noteIconFor(icon)
  return <Icon size={size} className={className} />
}

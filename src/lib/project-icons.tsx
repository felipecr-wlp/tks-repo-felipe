/**
 * Registro compartido de iconos de proyecto (lucide, sin emojis).
 *
 * El campo `projects.icon` guarda una CLAVE estable (ej. 'rocket'), no un emoji.
 * Render centralizado en <ProjectIcon /> para que todas las superficies (sidebar,
 * página de equipo, workspace del proyecto, command palette, picker) se vean igual.
 * Proyectos antiguos que aún tengan un emoji guardado caen al icono `Hash`.
 */
import {
  ClipboardList,
  Rocket,
  Lightbulb,
  Target,
  Wrench,
  BarChart3,
  Palette,
  FlaskConical,
  Smartphone,
  Globe,
  Zap,
  Building2,
  Hash,
  type LucideIcon,
} from 'lucide-react'

// Orden en el que se muestran en el selector.
export const PROJECT_ICONS: { key: string; label: string; Icon: LucideIcon }[] = [
  { key: 'clipboard', label: 'Tablero', Icon: ClipboardList },
  { key: 'rocket', label: 'Lanzamiento', Icon: Rocket },
  { key: 'lightbulb', label: 'Idea', Icon: Lightbulb },
  { key: 'target', label: 'Objetivo', Icon: Target },
  { key: 'wrench', label: 'Herramientas', Icon: Wrench },
  { key: 'chart', label: 'Métricas', Icon: BarChart3 },
  { key: 'palette', label: 'Diseño', Icon: Palette },
  { key: 'flask', label: 'Investigación', Icon: FlaskConical },
  { key: 'phone', label: 'Móvil', Icon: Smartphone },
  { key: 'globe', label: 'Web', Icon: Globe },
  { key: 'zap', label: 'Rápido', Icon: Zap },
  { key: 'building', label: 'Obra', Icon: Building2 },
]

export const DEFAULT_PROJECT_ICON = 'clipboard'

const ICON_MAP = new Map(PROJECT_ICONS.map(i => [i.key, i.Icon]))

/** Devuelve el componente lucide para una clave, o Hash si no se reconoce. */
export function projectIconFor(key: string | null | undefined): LucideIcon {
  if (!key) return Hash
  return ICON_MAP.get(key) ?? Hash
}

/** Render de icono de proyecto por clave. Cae a Hash para claves desconocidas o emojis viejos. */
export function ProjectIcon({
  icon,
  size = 16,
  className,
}: {
  icon: string | null | undefined
  size?: number
  className?: string
}) {
  const Icon = projectIconFor(icon)
  return <Icon size={size} className={className} />
}

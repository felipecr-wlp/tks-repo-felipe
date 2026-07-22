/* Mapa de nombres de icono (contenido de cursos) -> componentes lucide. */
import {
  AlertTriangle,
  Building2,
  GraduationCap,
  Compass,
  Database,
  Landmark,
  Layers,
  Lock,
  Mic,
  Receipt,
  Repeat,
  Ruler,
  Shield,
  Target,
  Users,
  Wrench,
  FileText,
  Lightbulb,
  Send,
  Trophy,
  BookOpen,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  alert: AlertTriangle,
  building: Building2,
  cap: GraduationCap,
  compass: Compass,
  database: Database,
  landmark: Landmark,
  layers: Layers,
  lock: Lock,
  mic: Mic,
  receipt: Receipt,
  repeat: Repeat,
  ruler: Ruler,
  shield: Shield,
  target: Target,
  users: Users,
  wrench: Wrench,
  file: FileText,
  lightbulb: Lightbulb,
  send: Send,
  trophy: Trophy,
}

export function AcademyIcon({
  name,
  className,
}: {
  name: string | undefined
  className?: string
}) {
  const Cmp = (name && ICONS[name]) || BookOpen
  return <Cmp className={className} />
}

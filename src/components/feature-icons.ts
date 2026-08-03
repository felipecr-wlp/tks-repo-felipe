/**
 * Icono de cada funcion del catalogo (`src/lib/features.ts`).
 *
 * Vive fuera de `features.ts` porque ese modulo tambien lo importa el servidor y
 * arrastrar componentes de React a la capa de datos no aporta nada.
 *
 * Vive fuera de `Sidebar.tsx` porque ya no es la barra la unica que lo necesita:
 * el marketplace de herramientas pinta el mismo catalogo y tiene que verse
 * igual. Dos mapas separados se desincronizan en el primer modulo nuevo, y el
 * sintoma (un icono distinto en cada pantalla) es de los que nadie reporta.
 *
 * El tipo `Record<FeatureKey, LucideIcon>` es lo que hace cumplir la regla: al
 * agregar una clave al catalogo, TypeScript exige su icono aqui. No se puede
 * olvidar.
 */
import {
  Inbox,
  CheckSquare,
  Home,
  MessagesSquare,
  GraduationCap,
  BookOpen,
  CalendarDays,
  ClipboardList,
  FileText,
  PenTool,
  Workflow,
  Target,
  BarChart3,
  Timer,
  Compass,
  IdCard,
  Images,
  Store,
  ConciergeBell,
  type LucideIcon,
} from 'lucide-react'
import type { FeatureKey } from '@/lib/features'

export const FEATURE_ICONS: Record<FeatureKey, LucideIcon> = {
  inbox: Inbox,
  'my-tasks': CheckSquare,
  home: Home,
  general: MessagesSquare,
  guia: GraduationCap,
  academia: BookOpen,
  calendar: CalendarDays,
  reportes: ClipboardList,
  notes: FileText,
  whiteboards: PenTool,
  flows: Workflow,
  goals: Target,
  analytics: BarChart3,
  tracking: Timer,
  projects: Compass,
  cv: IdCard,
  contenidos: Images,
  // Campanita de mostrador y no `Ticket`: ese ya es el icono de Invitaciones en
  // ajustes, y repetirlo haria que dos cosas distintas se vean igual. La
  // campanita dice lo que hace el modulo, pedir algo y esperar respuesta.
  solicitudes: ConciergeBell,
  marketplace: Store,
}

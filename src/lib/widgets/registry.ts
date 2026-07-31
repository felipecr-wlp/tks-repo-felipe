import type { LucideIcon } from 'lucide-react'
import { Hash, Clock } from 'lucide-react'

/**
 * Widget Registry — Phase 1
 * Mapea component IDs del widget_catalog a sus implementaciones React.
 * Los widgets se renderizan como Server Components hijos del WidgetSlot.
 */

export interface WidgetManifest {
  id: string
  name: string
  description?: string
  icon: string
  slot: 'dashboard' | 'sidebar' | 'header'
  component: string
}

export interface WidgetInstall {
  id: string
  app_id: string
  plugin_type: string
  manifest: Record<string, any>
  enabled: boolean
  widget?: WidgetManifest
}

export const WIDGET_ICONS: Record<string, LucideIcon> = {
  hash: Hash,
  clock: Clock,
}

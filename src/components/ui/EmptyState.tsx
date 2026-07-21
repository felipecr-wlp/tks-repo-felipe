/**
 * EmptyState, vacío consistente para todas las vistas.
 * Un solo look and feel (icono tenue + título + microcopy + acción opcional)
 * para reemplazar los vacíos ad-hoc que daban sensación de v1. Es un componente
 * de presentación puro; sirve tanto en Server como en Client Components.
 */
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  compact = false,
}: {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  className?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center rounded-xl border border-dashed border-border bg-muted/20',
        compact ? 'px-4 py-8' : 'px-6 py-12',
        className
      )}
    >
      {icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground/80">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && (
        <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

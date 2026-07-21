'use client'

/**
 * ErrorState, error consistente con botón de reintentar.
 * Unifica el manejo de fallos de fetch en Client Components (mismo lenguaje
 * visual que la burbuja de chat flotante). Si se pasa `onRetry` muestra el
 * botón; si no, solo el mensaje.
 */
import { cn } from '@/lib/utils'
import { AlertCircle, RotateCw } from 'lucide-react'

export function ErrorState({
  title = 'Algo salió mal',
  description = 'No pudimos cargar esta sección. Inténtalo de nuevo.',
  onRetry,
  retrying = false,
  className,
  compact = false,
}: {
  title?: string
  description?: string
  onRetry?: () => void
  retrying?: boolean
  className?: string
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center rounded-xl border border-border bg-card',
        compact ? 'px-4 py-8' : 'px-6 py-12',
        className
      )}
    >
      <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-rose-500/10 text-rose-500">
        <AlertCircle className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-muted-foreground">{description}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
        >
          <RotateCw className={cn('h-3.5 w-3.5', retrying && 'animate-spin')} />
          {retrying ? 'Reintentando…' : 'Reintentar'}
        </button>
      )}
    </div>
  )
}

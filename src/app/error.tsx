'use client'

/**
 * Error boundary global on-brand (Circuito B28).
 * Reemplaza la pantalla generica de Next.js ante un error no controlado
 * fuera del contexto de workspace (login, onboarding, etc.).
 */
import { useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[WLO] Error no controlado:', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center space-y-4 max-w-sm px-6">
        <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
          <TriangleAlert className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Algo salió mal</h1>
        <p className="text-sm text-muted-foreground">
          Ocurrió un error inesperado. Puedes intentar de nuevo, si persiste avísale al equipo.
        </p>
        <button
          onClick={reset}
          className="inline-flex items-center justify-center rounded-md bg-primary text-primary-foreground text-sm font-medium px-4 py-2 hover:opacity-90 transition-opacity"
        >
          Reintentar
        </button>
      </div>
    </div>
  )
}

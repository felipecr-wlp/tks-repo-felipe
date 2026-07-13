'use client'

/**
 * Error boundary dentro de un workspace (Circuito B28).
 * Al ser sibling del layout del workspace, si el error viene de una pagina
 * hija el sidebar se mantiene montado y el usuario no pierde el contexto
 * de navegacion mientras reintenta.
 */
import { useEffect } from 'react'
import { TriangleAlert } from 'lucide-react'

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[WLO] Error en workspace:', error)
  }, [error])

  return (
    <div className="flex-1 flex items-center justify-center bg-background">
      <div className="text-center space-y-4 max-w-sm px-6">
        <div className="w-12 h-12 bg-destructive/10 rounded-full flex items-center justify-center mx-auto">
          <TriangleAlert className="h-6 w-6 text-destructive" />
        </div>
        <h1 className="text-xl font-semibold text-foreground">Algo salió mal</h1>
        <p className="text-sm text-muted-foreground">
          No pudimos cargar esta vista. Puedes intentar de nuevo sin perder tu lugar.
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

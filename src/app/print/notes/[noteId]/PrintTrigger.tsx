'use client'

/**
 * Dispara el diálogo de impresión del navegador al abrir la vista de impresión,
 * y ofrece un botón manual. El usuario elige "Guardar como PDF" como destino.
 * Los controles se ocultan en la impresión (clase `no-print` + @media print).
 */
import { useEffect } from 'react'
import { Printer, X } from 'lucide-react'

export function PrintTrigger() {
  useEffect(() => {
    // Esperar un frame a que el contenido (prose) termine de pintar antes de
    // abrir el diálogo, para que el PDF salga completo.
    const t = setTimeout(() => window.print(), 400)
    return () => clearTimeout(t)
  }, [])

  return (
    <div className="print:hidden fixed top-4 right-4 z-50 flex items-center gap-2">
      <button
        onClick={() => window.print()}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors"
      >
        <Printer className="h-4 w-4" />
        Guardar como PDF
      </button>
      <button
        onClick={() => window.close()}
        title="Cerrar"
        className="inline-flex items-center justify-center rounded-md border border-border bg-background p-1.5 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

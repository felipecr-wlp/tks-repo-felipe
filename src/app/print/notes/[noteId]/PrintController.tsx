'use client'

/**
 * Controlador de la vista de impresión.
 *
 * 1) Renderiza las PIZARRAS incrustadas como imagen. En el contenido de la nota
 *    cada pizarra es solo un `<div data-whiteboard data-id="...">` vacío (guarda
 *    una referencia, no la imagen). Aquí, tras montar, buscamos esos divs, traemos
 *    la escena de cada pizarra y la convertimos a SVG con `exportToSvg` de
 *    Excalidraw, inyectándola para que SÍ salga en el PDF.
 * 2) Cuando las pizarras ya están pintadas, dispara `window.print()`. El usuario
 *    elige "Guardar como PDF" como destino.
 *
 * Los controles se ocultan en la impresión (`print:hidden`).
 */
import { useCallback, useEffect, useState } from 'react'
import { Printer, X, Loader2 } from 'lucide-react'

export function PrintController() {
  const [status, setStatus] = useState<'preparing' | 'ready'>('preparing')

  const renderWhiteboards = useCallback(async () => {
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('article [data-whiteboard][data-id]'),
    )
    if (nodes.length === 0) return

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mod: any
    try {
      mod = await import('@excalidraw/excalidraw')
    } catch {
      return // sin la librería, dejamos los bloques vacíos (no romper el PDF)
    }
    const exportToSvg = mod.exportToSvg
    if (typeof exportToSvg !== 'function') return

    await Promise.all(
      nodes.map(async (el) => {
        const id = el.getAttribute('data-id')
        if (!id) return
        try {
          const res = await fetch(`/api/whiteboards/${id}`)
          if (!res.ok) return
          const data = await res.json()
          const parsed = data.content ? JSON.parse(data.content) : null
          const elements = parsed?.elements ?? []

          if (!elements.length) {
            el.innerHTML =
              '<p style="color:#888;font-size:12px;font-style:italic;margin:0">Pizarra sin contenido.</p>'
            return
          }

          const svg: SVGSVGElement = await exportToSvg({
            elements,
            appState: {
              ...(parsed.appState ?? {}),
              exportWithDarkMode: false,
              exportBackground: true,
              viewBackgroundColor: '#ffffff',
            },
            files: parsed.files ?? null,
          })

          svg.style.maxWidth = '100%'
          svg.style.height = 'auto'
          svg.style.border = '1px solid #ddd'
          svg.style.borderRadius = '6px'
          svg.style.display = 'block'
          el.innerHTML = ''
          el.appendChild(svg)
        } catch {
          // silencioso: una pizarra que falle no debe tumbar el resto del PDF
        }
      }),
    )
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await renderWhiteboards()
      if (cancelled) return
      setStatus('ready')
      // Esperar a que el navegador pinte los SVG antes de abrir el diálogo.
      setTimeout(() => { if (!cancelled) window.print() }, 350)
    })()
    return () => { cancelled = true }
  }, [renderWhiteboards])

  return (
    <div className="print:hidden fixed top-4 right-4 z-50 flex items-center gap-2">
      <button
        onClick={() => window.print()}
        disabled={status === 'preparing'}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 transition-colors disabled:opacity-60"
      >
        {status === 'preparing'
          ? <><Loader2 className="h-4 w-4 animate-spin" /> Preparando…</>
          : <><Printer className="h-4 w-4" /> Guardar como PDF</>}
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

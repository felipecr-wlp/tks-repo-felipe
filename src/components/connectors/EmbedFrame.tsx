'use client'

/**
 * Iframe de herramienta externa + relay de descargas.
 *
 * El iframe corre en un origen opaco (sin allow-same-origin): aunque el sandbox
 * concede allow-downloads, varios navegadores siguen frenando descargas de
 * blobs creados adentro (URL blob:null/...) o las tratan como descargas
 * sospechosas. Pelear con eso es perder tiempo: la herramienta pide la
 * descarga por postMessage y este componente la ejecuta en el documento de
 * WLO, que no tiene ninguna restriccion.
 *
 * La validacion del mensaje es por event.source, NO por event.origin: un iframe
 * sandboxed serializa su origen como "null" y comparar origenes es imposible.
 * Comprobar que el mensaje viene exactamente del contentWindow de este iframe
 * es el candado correcto.
 */
import { useEffect, useRef } from 'react'

/**
 * Techo duro del canal: 10 MB de contenido exportable. Sin esto, una
 * herramienta (o un bug suyo) podria usar el relay para hacer que WLO
 * descargue archivos enormes sin consentimiento adicional.
 */
const MAX_CARACTERES = 10 * 1024 * 1024

export function EmbedFrame({
  src,
  title,
  sandbox,
  className,
}: {
  src: string
  title: string
  sandbox: string
  className?: string
}) {
  const ref = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: unknown; filename?: unknown; content?: unknown } | null
      if (!data || data.type !== 'wlo-request-download') return
      // Solo mensajes de ESTE iframe. Otra ventana, otra pestana u otra
      // herramienta quedan fuera con esta comparacion.
      if (!ref.current || e.source !== ref.current.contentWindow) return
      const filename = typeof data.filename === 'string' ? data.filename : ''
      const content = typeof data.content === 'string' ? data.content : ''
      if (!content || content.length > MAX_CARACTERES) return
      // Nombre plano: sin rutas ni caracteres especiales. El contenido manda;
      // el nombre es una sugerencia que se limpia, nunca se confia.
      const base = filename.split(/[\\/]/).pop() ?? ''
      const limpio = base.replace(/[^A-Za-z0-9._ ()\-]/g, '_').slice(0, 120) || 'archivo.json'
      const blob = new Blob([content], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = limpio
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      // Aviso a la herramienta para que no muestre su respaldo de copiado.
      if (e.source) e.source.postMessage({ type: 'wlo-download-ok' }, '*')
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  return (
    <iframe
      ref={ref}
      src={src}
      title={title}
      sandbox={sandbox}
      referrerPolicy="no-referrer"
      className={className}
    />
  )
}

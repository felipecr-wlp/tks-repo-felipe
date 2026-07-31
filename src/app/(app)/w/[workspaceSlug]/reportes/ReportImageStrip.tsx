'use client'

/**
 * Tira de evidencia de una actividad: miniaturas + visor.
 *
 * Aqui es donde se decide casi todo el egress del modulo. La regla es simple:
 * el listado NUNCA descarga el original. Se pintan miniaturas de ~20KB que el
 * servidor ya firmo en lote al renderizar la pagina, y la version completa se
 * pide (y se firma) solo cuando alguien hace clic para verla en grande.
 *
 * Un dia con veinte capturas cuesta ~400KB de bajada en vez de ~5MB, y solo se
 * pagan los originales que de verdad se miraron. Por eso el visor hace fetch al
 * abrir y no precarga nada: precargar seria volver al problema.
 *
 * Las miniaturas van con `loading="lazy"` y con width/height declarados. Lo
 * segundo no es cosmetico: sin dimensiones el navegador no reserva el hueco y
 * la linea de tiempo salta cuando cada imagen termina de bajar.
 */
import { useCallback, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export interface ReporteImagen {
  id: string
  thumb_url: string | null
  width: number | null
  height: number | null
  caption: string | null
}

interface Props {
  images: ReporteImagen[]
  /** Solo el dueño del reporte puede quitar evidencia. */
  canDelete?: boolean
  onDeleted?: (id: string) => void
}

export function ReportImageStrip({ images, canDelete = false, onDeleted }: Props) {
  const [abierta, setAbierta] = useState<ReporteImagen | null>(null)

  if (images.length === 0) return null

  return (
    <>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {images.map(img => (
          <button
            key={img.id}
            type="button"
            onClick={() => setAbierta(img)}
            title={img.caption ?? 'Ver imagen'}
            className="group relative h-16 w-16 overflow-hidden rounded-lg border border-border bg-muted transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-ring/40"
          >
            {img.thumb_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={img.thumb_url}
                alt={img.caption ?? 'Evidencia del reporte'}
                width={64}
                height={64}
                loading="lazy"
                decoding="async"
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                sin vista
              </span>
            )}
          </button>
        ))}
      </div>

      {abierta && (
        <Visor
          image={abierta}
          canDelete={canDelete}
          onClose={() => setAbierta(null)}
          onDeleted={id => {
            setAbierta(null)
            onDeleted?.(id)
          }}
        />
      )}
    </>
  )
}

/**
 * Visor a pantalla completa. Pide la URL firmada del original al abrirse.
 *
 * La firma dura 5 minutos y no se guarda en ningun lado: cerrar y volver a
 * abrir vuelve a pedirla. Es a proposito. Una URL firmada es un permiso
 * portatil, y una que se cachea en el cliente es un permiso que sobrevive a que
 * la persona deje de tener acceso.
 */
function Visor({
  image,
  canDelete,
  onClose,
  onDeleted,
}: {
  image: ReporteImagen
  canDelete: boolean
  onClose: () => void
  onDeleted: (id: string) => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [borrando, setBorrando] = useState(false)

  useEffect(() => {
    let vivo = true
    setUrl(null)
    setError(null)
    fetch(`/api/daily-reports/images/${image.id}`)
      .then(async r => {
        const json = (await r.json()) as { url?: string; error?: string }
        if (!vivo) return
        if (!r.ok || !json.url) {
          setError(json.error ?? 'No se pudo abrir la imagen')
          return
        }
        setUrl(json.url)
      })
      .catch(() => {
        if (vivo) setError('No se pudo abrir la imagen')
      })
    return () => {
      vivo = false
    }
  }, [image.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const borrar = useCallback(async () => {
    if (!confirm('¿Quitar esta imagen del reporte?')) return
    setBorrando(true)
    const res = await fetch(`/api/daily-reports/images/${image.id}`, { method: 'DELETE' })
    setBorrando(false)
    if (res.ok) onDeleted(image.id)
  }, [image.id, onDeleted])

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex max-h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-card shadow-overlay"
      >
        <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <p className="truncate text-sm text-muted-foreground">
            {image.caption ?? 'Evidencia del reporte'}
          </p>
          <div className="flex flex-shrink-0 items-center gap-1">
            {canDelete && (
              <button
                onClick={borrar}
                disabled={borrando}
                className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                Quitar
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </header>

        <div className={cn('flex min-h-[200px] items-center justify-center overflow-auto bg-muted/40 p-3')}>
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={image.caption ?? 'Evidencia del reporte'}
              className="max-h-[70vh] w-auto rounded-lg object-contain"
            />
          ) : (
            <p className="text-sm text-muted-foreground">Abriendo imagen...</p>
          )}
        </div>
      </div>
    </div>
  )
}

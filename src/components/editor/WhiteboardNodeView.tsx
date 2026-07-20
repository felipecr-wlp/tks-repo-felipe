'use client'

/**
 * NodeView de la pizarra incrustada.
 *
 * Inline, la nota muestra solo una TARJETA ligera (titulo + boton). El lienzo
 * Excalidraw (~1MB) se monta EN UN MODAL a pantalla casi completa, montado via
 * portal sobre `document.body`.
 *
 * Por que modal y no inline: Excalidraw mapea las coordenadas del puntero contra
 * el `getBoundingClientRect` de su contenedor. Dentro del editor de la nota (un
 * contenedor con scroll `overflow-y-auto`, layout que se asienta tarde y nodos
 * `contentEditable` alrededor) esa caja se desalineaba y las figuras salian
 * corridas/recortadas. En un modal `fixed inset-0` anclado al viewport el lienzo
 * tiene una caja estable y grande, asi que dibujar y ver funcionan bien.
 *
 * Guardado: debounce 1.5s al cambiar la escena, reutilizando PATCH
 * /api/whiteboards/[id] (misma ruta que la pizarra de pantalla completa).
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import dynamic from 'next/dynamic'
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import '@excalidraw/excalidraw/index.css'
import { PenTool, Maximize2, Trash2, GripVertical, Loader2, X } from 'lucide-react'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then((m) => m.Excalidraw),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin mr-2" /> Cargando lienzo…
      </div>
    ),
  }
)

// Referencia estable de opciones de UI: un objeto inline nuevo por render hace
// que Excalidraw se re-mida y encoja el canvas.
const UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    export: { saveFileToDisk: true },
  },
} as const

interface BoardMeta {
  title: string
  content: string | null
}

// Deriva el slug del workspace desde la URL (/w/{slug}/notes/...), para el link
// a la pizarra de pantalla completa sin tener que propagar el slug por props.
function workspaceSlugFromPath(): string | null {
  if (typeof window === 'undefined') return null
  const m = window.location.pathname.match(/\/w\/([^/]+)/)
  return m ? m[1] : null
}

export function WhiteboardNodeView({ node, deleteNode, editor }: NodeViewProps) {
  const id = node.attrs.id as string | null
  const height = (node.attrs.height as number) || 460
  const editable = editor.isEditable

  const [board, setBoard] = useState<BoardMeta | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // El portal necesita document.body: solo tras montar en cliente.
  useEffect(() => { setMounted(true) }, [])

  // Cargar metadata de la pizarra (titulo + escena) una vez.
  useEffect(() => {
    if (!id) { setNotFound(true); return }
    let cancel = false
    fetch(`/api/whiteboards/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancel) setBoard({ title: d.title ?? 'Pizarra', content: d.content ?? null }) })
      .catch(() => { if (!cancel) setNotFound(true) })
    return () => { cancel = true }
  }, [id])

  // Escena inicial parseada una sola vez desde el contenido cargado.
  const initialData = useMemo(() => {
    if (!board?.content) return undefined
    try { return JSON.parse(board.content) } catch { return undefined }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.content])

  // Autosave con debounce 1.5s (solo en modo edicion).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onChange = useCallback((elements: readonly any[], appState: any) => {
    if (!id || !editable) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const serialized = JSON.stringify({
        elements,
        appState: {
          viewBackgroundColor: appState.viewBackgroundColor,
          gridSize: appState.gridSize,
          theme: appState.theme,
        },
      })
      fetch(`/api/whiteboards/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: serialized }),
      })
        .then((r) => { if (!r.ok) throw new Error() })
        .catch(() => toast.error('No se pudo guardar la pizarra'))
    }, 1500)
  }, [id, editable])

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  // Al montar Excalidraw en el modal, re-medir el canvas para que ocupe la caja
  // completa del modal (el primer frame puede llegar antes de que el modal tenga
  // su tamaño final).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleApi = useCallback((api: any) => {
    apiRef.current = api
    const refresh = () => apiRef.current?.refresh?.()
    requestAnimationFrame(refresh)
    setTimeout(refresh, 120)
    setTimeout(refresh, 400)
  }, [])

  // Bloquear scroll del body y cerrar con Escape mientras el modal esta abierto.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const slug = workspaceSlugFromPath()

  const modal = open && board && mounted
    ? createPortal(
        <div
          className="fixed inset-0 z-[200] flex flex-col bg-black/60 backdrop-blur-sm"
          onPointerDown={(e) => { if (e.target === e.currentTarget) setOpen(false) }}
        >
          {/* Panel */}
          <div className="m-auto flex h-[92vh] w-[94vw] max-w-[1400px] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
            {/* Cabecera del modal */}
            <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
              <PenTool className="h-4 w-4 flex-shrink-0 text-primary" />
              <span className="flex-1 truncate text-sm font-medium text-foreground">
                {board.title}
                {!editable && <span className="ml-2 text-[11px] text-muted-foreground">(solo lectura)</span>}
              </span>
              {id && slug && (
                <Link
                  href={`/w/${slug}/whiteboards/${id}`}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  title="Abrir en pantalla completa"
                >
                  <Maximize2 className="h-4 w-4" />
                </Link>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                title="Cerrar (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Lienzo: contenedor con tamaño explicito (flex-1) + Excalidraw absoluto */}
            <div className="relative min-h-0 flex-1">
              <div className="absolute inset-0">
                <ErrorBoundary
                  fallback={(retry) => (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                      <span>No se pudo cargar el lienzo.</span>
                      <button
                        type="button"
                        onClick={retry}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                      >
                        Reintentar
                      </button>
                    </div>
                  )}
                >
                  <Excalidraw
                    excalidrawAPI={handleApi}
                    initialData={initialData}
                    onChange={onChange}
                    viewModeEnabled={!editable}
                    UIOptions={UI_OPTIONS}
                  />
                </ErrorBoundary>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null

  return (
    <NodeViewWrapper className="my-3" data-whiteboard-embed="">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        {/* Cabecera de la tarjeta */}
        <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
          {editable && (
            <span
              data-drag-handle
              contentEditable={false}
              className="cursor-grab text-muted-foreground hover:text-foreground"
              title="Arrastrar"
            >
              <GripVertical className="h-4 w-4" />
            </span>
          )}
          <PenTool className="h-4 w-4 flex-shrink-0 text-primary" />
          <span className="flex-1 truncate text-sm font-medium text-foreground">
            {board?.title ?? (notFound ? 'Pizarra no disponible' : 'Pizarra')}
          </span>
          {id && slug && (
            <Link
              href={`/w/${slug}/whiteboards/${id}`}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title="Abrir en pantalla completa"
            >
              <Maximize2 className="h-4 w-4" />
            </Link>
          )}
          {editable && (
            <button
              type="button"
              onClick={() => deleteNode()}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-red-500"
              title="Quitar pizarra de la nota"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Cuerpo: tarjeta ligera que abre el modal */}
        {notFound ? (
          <div
            className="flex items-center justify-center text-sm text-muted-foreground"
            style={{ height }}
          >
            Esta pizarra ya no existe o no tienes acceso.
          </div>
        ) : (
          <button
            type="button"
            contentEditable={false}
            onClick={() => setOpen(true)}
            disabled={!board}
            className="flex w-full flex-col items-center justify-center gap-2 text-muted-foreground transition-colors hover:bg-accent/40 disabled:opacity-60"
            style={{ height }}
          >
            {!board ? (
              <>
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">Cargando pizarra…</span>
              </>
            ) : (
              <>
                <span className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <PenTool className="h-7 w-7" />
                </span>
                <span className="text-sm font-medium text-foreground">
                  {editable ? 'Abrir pizarra para ver o dibujar' : 'Abrir pizarra'}
                </span>
                <span className="text-[11px]">Se abre en un lienzo grande (Excalidraw)</span>
              </>
            )}
          </button>
        )}
      </div>

      {modal}
    </NodeViewWrapper>
  )
}

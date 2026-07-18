'use client'

/**
 * NodeView de la pizarra incrustada. Renderiza inline el lienzo Excalidraw de la
 * pizarra referenciada por `id`. Excalidraw es pesado (~1MB), asi que el lienzo
 * se monta SOLO cuando el usuario activa el bloque (click en "Abrir lienzo"),
 * igual que Notion/Confluence cargan embeds pesados bajo demanda. Antes de eso se
 * muestra una tarjeta ligera con el titulo de la pizarra.
 *
 * Guardado: debounce 1.5s al cambiar la escena, reutilizando PATCH
 * /api/whiteboards/[id] (misma ruta que la pizarra de pantalla completa).
 */
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import '@excalidraw/excalidraw/index.css'
import { PenTool, Maximize2, Trash2, GripVertical, Loader2 } from 'lucide-react'
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

  const [active, setActive] = useState(false)
  const [board, setBoard] = useState<BoardMeta | null>(null)
  const [notFound, setNotFound] = useState(false)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

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
      }).catch(() => toast.error('No se pudo guardar la pizarra'))
    }, 1500)
  }, [id, editable])

  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current) }, [])

  // Al montar Excalidraw, re-medir el canvas (el contenedor puede asentarse tras
  // hidratacion/fuentes y quedar con ancho viejo).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleApi = useCallback((api: any) => {
    apiRef.current = api
    const refresh = () => apiRef.current?.refresh?.()
    requestAnimationFrame(refresh)
    setTimeout(refresh, 120)
    setTimeout(refresh, 400)
  }, [])

  const slug = workspaceSlugFromPath()

  return (
    <NodeViewWrapper
      className="my-3"
      data-whiteboard-embed=""
    >
      <div
        ref={wrapRef}
        className="rounded-xl border border-border bg-card overflow-hidden shadow-sm"
      >
        {/* Cabecera */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-muted/40">
          {editable && (
            <span
              data-drag-handle
              contentEditable={false}
              className="cursor-grab text-muted-foreground hover:text-foreground"
              title="Arrastrar"
            >
              <GripVertical className="w-4 h-4" />
            </span>
          )}
          <PenTool className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="text-sm font-medium text-foreground truncate flex-1">
            {board?.title ?? (notFound ? 'Pizarra no disponible' : 'Pizarra')}
          </span>
          {id && slug && (
            <Link
              href={`/w/${slug}/whiteboards/${id}`}
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              title="Abrir en pantalla completa"
            >
              <Maximize2 className="w-4 h-4" />
            </Link>
          )}
          {editable && (
            <button
              type="button"
              onClick={() => deleteNode()}
              className="p-1 rounded text-muted-foreground hover:text-red-500 hover:bg-accent transition-colors"
              title="Quitar pizarra de la nota"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Cuerpo */}
        {notFound ? (
          <div
            className="flex items-center justify-center text-sm text-muted-foreground"
            style={{ height }}
          >
            Esta pizarra ya no existe o no tienes acceso.
          </div>
        ) : !active ? (
          <button
            type="button"
            onClick={() => setActive(true)}
            className="w-full flex flex-col items-center justify-center gap-2 text-muted-foreground hover:bg-accent/40 transition-colors"
            style={{ height }}
          >
            <PenTool className="w-7 h-7" />
            <span className="text-sm font-medium">
              {editable ? 'Abrir lienzo para dibujar' : 'Abrir lienzo'}
            </span>
            <span className="text-[11px]">Excalidraw incrustado</span>
          </button>
        ) : (
          // Contenedor del lienzo. stopPropagation en pointer/mouse para que
          // Excalidraw maneje sus propios eventos y ProseMirror no interfiera.
          <div
            style={{ height }}
            contentEditable={false}
            onPointerDownCapture={(e) => e.stopPropagation()}
            onMouseDownCapture={(e) => e.stopPropagation()}
            className="relative w-full min-w-0"
          >
            <div className="absolute inset-0">
              <ErrorBoundary
                fallback={(retry) => (
                  <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                    <span>No se pudo cargar el lienzo.</span>
                    <button
                      type="button"
                      onClick={retry}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent transition-colors"
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
        )}
      </div>
    </NodeViewWrapper>
  )
}

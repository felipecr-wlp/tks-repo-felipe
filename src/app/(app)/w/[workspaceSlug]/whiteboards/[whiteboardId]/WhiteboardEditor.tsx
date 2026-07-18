'use client'

/**
 * Editor de pizarra, Excalidraw lazy-loaded (~1MB+).
 * Auto-save con debounce 1.5s al cambiar el canvas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
// Estilos de Excalidraw: sin esto el toolbar se renderiza gigante y sin layout
// (los shapes salen como radios enormes apilados). Debe importarse una vez.
import '@excalidraw/excalidraw/index.css'
import { createClient } from '@/lib/supabase/client'
import { cn, getInitials, timeAgo } from '@/lib/utils'

// Excalidraw es muy pesado (~1MB), siempre lazy + ssr off
const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then(m => m.Excalidraw),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
        Cargando pizarra...
      </div>
    ),
  }
)

// Referencia ESTABLE (module-level): si se pasa un objeto literal inline a
// <Excalidraw>, cada re-render (p.ej. al cambiar el estado "Guardando…") le
// entrega una prop nueva y Excalidraw se re-mide, encogiendo el canvas. Fijarlo
// una sola vez evita ese re-measure espurio.
const UI_OPTIONS = {
  canvasActions: {
    loadScene: false,
    export: { saveFileToDisk: true },
  },
} as const

interface BoardData {
  id: string
  workspace_id: string
  title: string
  content: string | null
  visibility: string
  created_by: string | null
  updated_at: string
}

interface Props {
  initial: BoardData
  currentUserId: string
  currentUserName: string
  workspaceSlug: string
}

// Otro usuario presente en la pizarra (para el indicador "quién está viendo").
interface Viewer {
  userId: string
  name: string
}

export function WhiteboardEditor({ initial, currentUserId, currentUserName, workspaceSlug }: Props) {
  const router = useRouter()
  const [title, setTitle] = useState(initial.title)
  const [updatedAt, setUpdatedAt] = useState(initial.updated_at)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [viewers, setViewers] = useState<Viewer[]>([])
  const titleSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Contenedor del canvas: observado para re-patear la medición de Excalidraw
  // cuando el layout se asienta (CSS/fuentes/hidratación) o el sidebar cambia.
  const canvasWrapRef = useRef<HTMLDivElement>(null)
  // API de Excalidraw (para aplicar escenas remotas via updateScene).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiRef = useRef<any>(null)
  // Última cadena de contenido que enviamos o recibimos: sirve para no re-aplicar
  // nuestro propio eco ni pisar (clobber) la escena con algo idéntico.
  const lastContentRef = useRef<string | null>(initial.content)
  // Hay una edición local en vuelo (debounce pendiente): no aplicar remoto encima.
  const localDirtyRef = useRef(false)

  const isOwner = initial.created_by === currentUserId

  // Parsear contenido inicial UNA sola vez (memoizado). Si se recalcula en cada
  // render, <Excalidraw> recibe un initialData nuevo al togglear "Guardando…" y
  // se resetea/re-mide con ancho equivocado (canvas encogido).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initialData = useMemo<any>(() => {
    if (!initial.content) return undefined
    try {
      return JSON.parse(initial.content)
    } catch {
      return undefined
    }
    // Solo depende del contenido inicial del server; no debe recomputarse por
    // cambios de estado locales (saving/updatedAt).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patch = useCallback(async (data: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = await fetch(`/api/whiteboards/${initial.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Error')
      }
      const j = await res.json()
      setUpdatedAt(j.updated_at)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setSaving(false)
    }
  }, [initial.id])

  // Auto-save título debounced
  useEffect(() => {
    if (title === initial.title) return
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current)
    titleSaveTimer.current = setTimeout(() => {
      patch({ title: title.trim() || 'Pizarra sin título' })
    }, 800)
    return () => { if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current) }
  }, [title, initial.title, patch])

  // Save canvas con debounce 1.5s al cambiar
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onChange = useCallback((elements: readonly any[], appState: any) => {
    // Marca edición local en vuelo: bloquea aplicar escenas remotas encima
    // mientras el usuario está dibujando (evita clobber).
    localDirtyRef.current = true
    if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current)
    contentSaveTimer.current = setTimeout(() => {
      const serialized = JSON.stringify({
        elements,
        appState: {
          // Solo persistir cosas relevantes; algunas appState props son volátiles
          viewBackgroundColor: appState.viewBackgroundColor,
          gridSize: appState.gridSize,
          theme: appState.theme,
        },
      })
      // Registrar lo que enviamos para reconocer nuestro propio eco por realtime.
      lastContentRef.current = serialized
      localDirtyRef.current = false
      patch({ content: serialized })
    }, 1500)
  }, [patch])

  useEffect(() => {
    return () => { if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current) }
  }, [])

  // Callback ESTABLE para recibir la API. Excalidraw lo invoca al montar; si la
  // referencia cambia en cada render (por el toggle de "Guardando…") arriesga
  // re-invocaciones y re-mediciones. useCallback lo fija.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleExcalidrawAPI = useCallback((api: any) => {
    apiRef.current = api
    // Refresco inmediato del tamaño usando la API oficial (más fiable que el
    // Event('resize') global): Excalidraw recalcula su bounding box del DOM.
    const refresh = () => apiRef.current?.refresh?.()
    requestAnimationFrame(refresh)
    setTimeout(refresh, 100)
    setTimeout(refresh, 400)
  }, [])

  // ResizeObserver sobre el contenedor del canvas: cada vez que su caja cambia
  // (layout asentándose, colapsar/expandir sidebar, resize de ventana),
  // pedimos a Excalidraw que se re-mida. Esto ataca la raíz del "canvas
  // recortado / no abarca todo": Excalidraw se quedaba con un ancho viejo.
  useEffect(() => {
    const el = canvasWrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => apiRef.current?.refresh?.())
    })
    ro.observe(el)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [])

  // ── Colaboración en vivo: escena remota + presencia ────────────────────────
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase.channel(`whiteboard-${initial.id}`, {
      config: { presence: { key: currentUserId } },
    })

    ch
      // Recarga de escena cuando otro usuario guarda cambios.
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'public', table: 'whiteboards', filter: `id=eq.${initial.id}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const remote = payload.new as { content: string | null; updated_at: string }
          setUpdatedAt(remote.updated_at)
          const content = remote.content
          if (!content) return
          // Anti-eco: si es idéntico a lo último que enviamos/aplicamos, ignorar.
          if (content === lastContentRef.current) return
          // Anti-clobber: si el usuario tiene una edición local en vuelo, no pisar.
          if (localDirtyRef.current) return
          const api = apiRef.current
          if (!api) return
          try {
            const scene = JSON.parse(content)
            lastContentRef.current = content
            api.updateScene({
              elements: scene.elements ?? [],
              appState: scene.appState ?? undefined,
            })
          } catch {
            // contenido corrupto: ignorar
          }
        }
      )
      // Presencia: quién está viendo la pizarra ahora mismo.
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState() as Record<string, Array<{ userId: string; name: string }>>
        const seen = new Map<string, Viewer>()
        for (const key of Object.keys(state)) {
          for (const meta of state[key]) {
            if (meta.userId && meta.userId !== currentUserId) {
              seen.set(meta.userId, { userId: meta.userId, name: meta.name })
            }
          }
        }
        setViewers(Array.from(seen.values()))
      })
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          ch.track({ userId: currentUserId, name: currentUserName })
        }
      })

    return () => { supabase.removeChannel(ch) }
  }, [initial.id, currentUserId, currentUserName])

  async function handleDelete() {
    if (!(await confirmDialog({ message: '¿Eliminar esta pizarra? No se puede deshacer.', destructive: true, confirmLabel: 'Eliminar' }))) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/whiteboards/${initial.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Error')
      }
      toast.success('Pizarra eliminada')
      router.push(`/w/${workspaceSlug}/whiteboards`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al eliminar')
      setDeleting(false)
    }
  }

  return (
    <div className="flex flex-col h-full w-full min-w-0">
      {/* Toolbar superior */}
      <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border bg-card">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Link
            href={`/w/${workspaceSlug}/whiteboards`}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1 flex-shrink-0"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <polyline points="7.5 9 4.5 6 7.5 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Pizarras
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="Pizarra sin título"
            className="text-sm font-medium text-foreground bg-transparent outline-none border-0 flex-1 min-w-0"
          />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Presencia: quién más está viendo la pizarra en vivo */}
          {viewers.length > 0 && (
            <div className="flex items-center -space-x-1.5 mr-1" title={`Viendo ahora: ${viewers.map(v => v.name).join(', ')}`}>
              {viewers.slice(0, 3).map(v => (
                <span
                  key={v.userId}
                  className="w-6 h-6 rounded-full bg-primary/15 border border-background flex items-center justify-center text-[10px] font-medium text-primary"
                >
                  {getInitials(v.name)}
                </span>
              ))}
              {viewers.length > 3 && (
                <span className="w-6 h-6 rounded-full bg-muted border border-background flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                  +{viewers.length - 3}
                </span>
              )}
            </div>
          )}

          {saving && (
            <span className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 border border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
              Guardando…
            </span>
          )}
          {!saving && (
            <span className="text-xs text-muted-foreground hidden md:inline">
              Guardado {timeAgo(updatedAt)}
            </span>
          )}

          {isOwner && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              title="Eliminar pizarra"
              className={cn(
                'p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors disabled:opacity-50'
              )}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2 4h10M5 4V2.5a.5.5 0 01.5-.5h3a.5.5 0 01.5.5V4M6 6.5v4M8 6.5v4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M3 4l.8 7.2A1 1 0 004.8 12h4.4a1 1 0 001-.8L11 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Canvas, el flex item exterior calcula la caja disponible; el hijo
          `absolute inset-0` le da a Excalidraw dimensiones de píxel CONCRETAS e
          inmediatas (sin ambigüedad de sizing intrínseco de flex, que hacía que
          midiera un ancho corto y se quedara recortado). */}
      <div ref={canvasWrapRef} className="relative flex-1 min-h-0 w-full min-w-0">
        <div className="absolute inset-0">
          <Excalidraw
            initialData={initialData}
            excalidrawAPI={handleExcalidrawAPI}
            onChange={onChange}
            UIOptions={UI_OPTIONS}
          />
        </div>
      </div>
    </div>
  )
}

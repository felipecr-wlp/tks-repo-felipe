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
import { useT } from '@/lib/i18n/LanguageProvider'
import { ChevronDown, Folder, Globe, Hexagon, Lock, Users } from 'lucide-react'

// Excalidraw es muy pesado (~1MB), siempre lazy + ssr off
function WhiteboardLoading() {
  const t = useT()
  return (
    <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
      {t('wb.loading')}
    </div>
  )
}

const Excalidraw = dynamic(
  () => import('@excalidraw/excalidraw').then(m => m.Excalidraw),
  {
    ssr: false,
    loading: () => <WhiteboardLoading />,
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

/**
 * Preferencias de dibujo (grosor del lapiz, color, relleno, opacidad...).
 *
 * Viven en el NAVEGADOR de cada quien, no en la pizarra, y la diferencia no es
 * un detalle: el grosor del trazo es de la PERSONA que dibuja, no del documento.
 * Si se guardaran con la pizarra, cambiar el lapiz se lo cambiaria en vivo a
 * todos los que la tienen abierta.
 *
 * Antes no se guardaban en ningun lado. La escena solo persistia fondo, rejilla
 * y tema, asi que el grosor que elegias se perdia al recargar y el lapiz volvia
 * al fino de siempre. Se elegia otra vez, y otra. Eso es lo que se estaba
 * pidiendo cuando se pedia "poner stroke width al lapicito": ya existe en el
 * panel de Excalidraw, lo que faltaba era que se quedara puesto.
 */
const CLAVE_ESTILO = 'wlo.pizarra.estilo'

const PROPS_ESTILO = [
  'currentItemStrokeColor',
  'currentItemBackgroundColor',
  'currentItemFillStyle',
  'currentItemStrokeWidth',
  'currentItemStrokeStyle',
  'currentItemRoughness',
  'currentItemOpacity',
  'currentItemFontFamily',
  'currentItemFontSize',
  'currentItemTextAlign',
  'currentItemEdges',
] as const

/** Se copia solo lo que exista, para no guardar undefined de props que cambien de nombre. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extraerEstilo(appState: any): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of PROPS_ESTILO) {
    if (appState?.[k] !== undefined) out[k] = appState[k]
  }
  return out
}

/**
 * Guarda el estilo actual, y solo si de verdad cambio.
 *
 * Se compara contra la ultima cadena escrita porque `onChange` se dispara
 * muchisimo (cada movimiento del puntero mientras se dibuja) y localStorage es
 * sincrono: escribir en cada evento seria pagar un bloqueo por nada.
 */
let ultimoEstiloEscrito: string | null = null

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function guardarEstilo(appState: any): void {
  if (typeof window === 'undefined') return
  const serializado = JSON.stringify(extraerEstilo(appState))
  if (serializado === ultimoEstiloEscrito) return
  try {
    window.localStorage.setItem(CLAVE_ESTILO, serializado)
    ultimoEstiloEscrito = serializado
  } catch {
    // Modo privado o cuota llena: es una preferencia, no vale romper el dibujo.
  }
}

function leerEstiloGuardado(): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null
  try {
    const crudo = window.localStorage.getItem(CLAVE_ESTILO)
    if (!crudo) return null
    const parsed = JSON.parse(crudo)
    // Si alguien dejo basura en la clave, se ignora: una preferencia rota no
    // puede impedir abrir la pizarra.
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

interface BoardData {
  id: string
  workspace_id: string
  title: string
  content: string | null
  visibility: string
  space_id: string | null
  /** Si esta puesto, la pizarra vive dentro de una nota y hereda su alcance. */
  note_id: string | null
  created_by: string | null
  updated_at: string
}

interface Props {
  initial: BoardData
  currentUserId: string
  currentUserName: string
  workspaceSlug: string
  canManage: boolean
  /** Departamentos con los que ESTE usuario puede compartir. */
  spaces: { id: string; name: string }[]
  /** Abrirla a toda la empresa es acto de mando. */
  canPublishWorkspace: boolean
}

// Alcance de una pizarra suelta: privada -> departamento -> empresa.
type ScopeChoice =
  | { kind: 'private' }
  | { kind: 'space'; spaceId: string }
  | { kind: 'workspace' }

// Otro usuario presente en la pizarra (para el indicador "quién está viendo").
interface Viewer {
  userId: string
  name: string
}

export function WhiteboardEditor({
  initial, currentUserId, currentUserName, workspaceSlug, canManage,
  spaces, canPublishWorkspace,
}: Props) {
  const router = useRouter()
  const t = useT()
  const [title, setTitle] = useState(initial.title)
  const [updatedAt, setUpdatedAt] = useState(initial.updated_at)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [visibility, setVisibility] = useState(initial.visibility)
  const [spaceId, setSpaceId] = useState(initial.space_id)
  const [showVisMenu, setShowVisMenu] = useState(false)
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

  // Parsear contenido inicial UNA sola vez (memoizado). Si se recalcula en cada
  // render, <Excalidraw> recibe un initialData nuevo al togglear "Guardando…" y
  // se resetea/re-mide con ancho equivocado (canvas encogido).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const initialData = useMemo<any>(() => {
    const escena = (() => {
      if (!initial.content) return undefined
      try {
        return JSON.parse(initial.content)
      } catch {
        return undefined
      }
    })()
    // Encima de la escena se re-aplican las preferencias de dibujo de ESTE
    // navegador. Van despues a proposito: el grosor del lapiz es de quien
    // dibuja, no de la pizarra, asi que gana sobre lo que traiga el documento.
    const estilo = leerEstiloGuardado()
    if (!estilo) return escena
    return {
      ...(escena ?? {}),
      appState: { ...(escena?.appState ?? {}), ...estilo },
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
      toast.error(err instanceof Error ? err.message : t('wb.saveError'))
    } finally {
      setSaving(false)
    }
  }, [initial.id, t])

  // Auto-save título debounced
  useEffect(() => {
    if (title === initial.title) return
    if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current)
    titleSaveTimer.current = setTimeout(() => {
      patch({ title: title.trim() || t('wb.untitled') })
    }, 800)
    return () => { if (titleSaveTimer.current) clearTimeout(titleSaveTimer.current) }
  }, [title, initial.title, patch, t])

  // Save canvas con debounce 1.5s al cambiar
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onChange = useCallback((elements: readonly any[], appState: any) => {
    // Marca edición local en vuelo: bloquea aplicar escenas remotas encima
    // mientras el usuario está dibujando (evita clobber).
    localDirtyRef.current = true
    if (contentSaveTimer.current) clearTimeout(contentSaveTimer.current)
    contentSaveTimer.current = setTimeout(() => {
      // El estilo se guarda aparte y SIEMPRE, aunque el dibujo no haya cambiado:
      // elegir un grosor de trazo no altera la escena, y es justo lo que se
      // quiere recordar.
      guardarEstilo(appState)

      const serialized = JSON.stringify({
        elements,
        appState: {
          // Solo persistir cosas relevantes; algunas appState props son volátiles
          viewBackgroundColor: appState.viewBackgroundColor,
          gridSize: appState.gridSize,
          theme: appState.theme,
        },
      })

      // Soltar el candado ANTES de cualquier salida: si se regresara con el
      // flag puesto, esta pizarra dejaria de aceptar cambios de los demas para
      // siempre (quedaria "sucia" sin tener nada pendiente).
      localDirtyRef.current = false

      // Excalidraw dispara onChange tambien al mover el lienzo, hacer zoom o
      // seleccionar algo, cosas que no cambian ni un pixel del dibujo. Antes
      // cada una de esas escribia en la base y despertaba por realtime a todos
      // los que tuvieran la pizarra abierta. Si lo serializado es identico a lo
      // ultimo conocido, no hay nada que guardar.
      if (serialized === lastContentRef.current) return

      // Registrar lo que enviamos para reconocer nuestro propio eco por realtime.
      lastContentRef.current = serialized
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

  /**
   * "Área": el poligono cerrado que Excalidraw YA sabe dibujar, pero con nombre.
   *
   * No existe una herramienta de poligono en la libreria (las formas son
   * rectangulo, rombo y elipse). La de LINEA hace exactamente lo que se pide:
   * un clic por esquina, se cierra sobre el primer punto y a partir de ahi
   * acepta relleno como cualquier figura. El problema nunca fue que faltara,
   * sino que se llama "linea" y en ningun lado dice que se pueda cerrar. Quien
   * queria marcar el area de un estacionamiento probaba con el rectangulo y se
   * rendia.
   *
   * Por eso el boton hace tres cosas y no una: activa la herramienta, le pone
   * un relleno visible (si la persona no eligio uno propio) y dice en una linea
   * como se usa. Sin el relleno el poligono sale hueco y no se lee como area.
   */
  const activarArea = useCallback(() => {
    const api = apiRef.current
    if (!api) return
    const estado = api.getAppState?.() ?? {}
    // Solo se impone relleno si no hay uno elegido: si alguien ya venia
    // pintando de rojo, se le respeta su color.
    const sinRelleno =
      !estado.currentItemBackgroundColor || estado.currentItemBackgroundColor === 'transparent'
    if (sinRelleno) {
      api.updateScene({
        appState: { currentItemBackgroundColor: '#a5d8ff', currentItemFillStyle: 'solid' },
      })
    }
    api.setActiveTool({ type: 'line' })
    toast.info(t('wb.areaHint'))
  }, [t])

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

  function handleScopeChange(choice: ScopeChoice) {
    setShowVisMenu(false)
    if (choice.kind === 'space') {
      setVisibility('space')
      setSpaceId(choice.spaceId)
      patch({ visibility: 'space', space_id: choice.spaceId })
      return
    }
    setVisibility(choice.kind)
    patch({ visibility: choice.kind })
  }

  async function handleDelete() {
    if (!(await confirmDialog({ message: t('wb.confirmDelete'), destructive: true, confirmLabel: t('common.delete') }))) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/whiteboards/${initial.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        throw new Error(j.error ?? 'Error')
      }
      toast.success(t('wb.deleted'))
      router.push(`/w/${workspaceSlug}/whiteboards`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('wb.deleteError'))
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
            {t('wb.title')}
          </Link>
          <span className="text-muted-foreground/50">/</span>
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder={t('wb.untitled')}
            className="text-sm font-medium text-foreground bg-transparent outline-none border-0 flex-1 min-w-0"
          />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Área: atajo a la herramienta de línea, que es la que cierra polígonos.
              Vive aquí arriba y no en la barra de Excalidraw porque esa la
              dibuja la librería y no admite botones propios. */}
          <button
            onClick={activarArea}
            title={t('wb.areaTitle')}
            className="flex items-center gap-1.5 text-xs px-2 py-1 bg-muted/50 hover:bg-muted text-foreground rounded-md transition-colors"
          >
            <Hexagon className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('wb.area')}</span>
          </button>

          {/* Presencia: quién más está viendo la pizarra en vivo */}
          {viewers.length > 0 && (
            <div className="flex items-center -space-x-1.5 mr-1" title={`${t('wb.viewingNow')} ${viewers.map(v => v.name).join(', ')}`}>
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
              {t('wb.saving')}
            </span>
          )}
          {!saving && (
            <span className="text-xs text-muted-foreground hidden md:inline">
              {t('wb.savedPrefix')} {timeAgo(updatedAt)}
            </span>
          )}

          {/* Alcance. Una pizarra incrustada no lo elige: lo hereda de su nota. */}
          {initial.note_id ? (
            <span
              className="flex items-center gap-1.5 text-xs px-2 py-1 bg-muted/50 text-muted-foreground rounded-md"
              title="Se comparte junto con la nota que la contiene"
            >
              <Lock className="w-3.5 h-3.5" />
              Alcance de la nota
            </span>
          ) : (
            <div className="relative">
              <button
                onClick={() => setShowVisMenu(!showVisMenu)}
                className="flex items-center gap-1.5 text-xs px-2 py-1 bg-muted/50 hover:bg-muted text-foreground rounded-md transition-colors"
              >
                {visibility === 'workspace' ? (
                  <span className="flex items-center gap-1.5"><Globe className="w-3.5 h-3.5" />Toda la empresa</span>
                ) : visibility === 'private' ? (
                  <span className="flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" />Privada</span>
                ) : visibility === 'project' ? (
                  <span className="flex items-center gap-1.5"><Folder className="w-3.5 h-3.5" />Proyecto</span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    {spaces.find(s => s.id === spaceId)?.name ?? 'Departamento'}
                  </span>
                )}
                <ChevronDown className="w-2.5 h-2.5" />
              </button>
              {showVisMenu && (
                <div
                  className="absolute top-7 right-0 z-50 w-64 bg-popover border border-border rounded-lg shadow-raised py-1"
                  onMouseLeave={() => setShowVisMenu(false)}
                >
                  <button
                    onClick={() => handleScopeChange({ kind: 'private' })}
                    className={cn(
                      'w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent transition-colors',
                      visibility === 'private' && 'bg-accent/50'
                    )}
                  >
                    <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <Lock className="w-3.5 h-3.5" />Privada
                    </span>
                    <span className="text-[10px] text-muted-foreground">Solo tú la puedes ver</span>
                  </button>

                  <div className="px-3 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Compartir con un departamento
                  </div>
                  {spaces.length === 0 ? (
                    <p className="px-3 pb-2 text-[10px] text-muted-foreground">
                      No perteneces a ningún departamento todavía.
                    </p>
                  ) : (
                    spaces.map(s => (
                      <button
                        key={s.id}
                        onClick={() => handleScopeChange({ kind: 'space', spaceId: s.id })}
                        className={cn(
                          'w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent transition-colors',
                          visibility !== 'private' && visibility !== 'workspace' && spaceId === s.id && 'bg-accent/50'
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                          <Users className="w-3.5 h-3.5" />{s.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          Visible solo para {s.name}
                        </span>
                      </button>
                    ))
                  )}

                  {canPublishWorkspace && (
                    <>
                      <div className="my-1 border-t border-border" />
                      <button
                        onClick={() => handleScopeChange({ kind: 'workspace' })}
                        className={cn(
                          'w-full flex flex-col items-start gap-0.5 px-3 py-2 text-left hover:bg-accent transition-colors',
                          visibility === 'workspace' && 'bg-accent/50'
                        )}
                      >
                        <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                          <Globe className="w-3.5 h-3.5" />Toda la empresa
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          Cualquier miembro del workspace la puede abrir
                        </span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {canManage && (
            <button
              onClick={handleDelete}
              disabled={deleting}
              title={t('wb.deleteBoard')}
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

'use client'

/**
 * Tablero de contenido: tres columnas, una ficha por pieza, un panel al abrirla.
 *
 * El objetivo de diseño es que se entienda sin explicacion: se ve la imagen, se
 * ve de que red es, se ve si le falta algo. Por eso no hay tableros anidados, ni
 * arrastrar y soltar, ni un menu de estados. Mover una pieza es un boton con el
 * nombre de lo que va a pasar ("Aprobar", "Marcar publicado"), y los botones que
 * no le tocan a esta persona no se dibujan.
 *
 * ── De donde sale cada imagen ───────────────────────────────────────────────
 * La portada llega firmada desde el servidor (miniatura, ~30KB). Las demas y las
 * versiones completas se piden UNA vez al abrir la pieza y se quedan en memoria
 * mientras dure la visita. Lo que nadie abre, no se descarga: ese es todo el
 * ahorro de egress, y esta puesto aqui a proposito y no en el servidor.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Images,
  Plus,
  X,
  Star,
  Check,
  Undo2,
  Trash2,
  Upload,
  MessageSquarePlus,
  ExternalLink,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import {
  CONTENT_NETWORKS,
  CONTENT_STATUSES,
  networkLabel,
  networkChip,
  getNetwork,
  prepareContentImage,
  MAX_ASSETS_PER_ITEM,
  type ContentStatus,
} from '@/lib/content/catalog'

export interface Correccion {
  id: string
  body: string
  kind: 'correccion' | 'nota'
  resolved_at: string | null
  created_at: string
  autor: string
}

export interface Pieza {
  id: string
  title: string
  caption: string | null
  network: string
  format: string | null
  status: ContentStatus
  rating: number | null
  scheduled_for: string | null
  published_at: string | null
  published_url: string | null
  autor: string
  puedeBorrar: boolean
  cover_url: string | null
  cover_w: number | null
  cover_h: number | null
  imagenes: number
  correcciones: Correccion[]
}

interface ImagenCompleta {
  id: string
  url: string | null
  width: number | null
  height: number | null
}

interface Props {
  workspaceId: string
  isManager: boolean
  piezasIniciales: Pieza[]
}

/** Correcciones sin atender. Es el unico numero que de verdad mueve el trabajo. */
function pendientes(p: Pieza): number {
  return p.correcciones.filter((c) => c.kind === 'correccion' && !c.resolved_at).length
}

function fechaCorta(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

// ── Estrellas ────────────────────────────────────────────────────────────────

function Estrellas({
  valor,
  onChange,
  size = 14,
}: {
  valor: number | null
  onChange?: (v: number | null) => void
  size?: number
}) {
  const activo = valor ?? 0
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          // Volver a tocar la estrella que ya estaba quita la calificacion. Sin
          // esto, un clic accidental deja un 1 que nadie sabe como borrar.
          onClick={() => onChange?.(activo === n ? null : n)}
          className={onChange ? 'cursor-pointer' : 'cursor-default'}
          title={onChange ? `Calificar con ${n}` : undefined}
          aria-label={`${n} de 5`}
        >
          <Star
            size={size}
            className={
              n <= activo
                ? 'fill-amber-400 text-amber-400'
                : 'text-muted-foreground/40'
            }
          />
        </button>
      ))}
    </span>
  )
}

// ── Ficha de la galeria ──────────────────────────────────────────────────────

function Ficha({ pieza, onAbrir }: { pieza: Pieza; onAbrir: () => void }) {
  const faltan = pendientes(pieza)
  return (
    <button
      type="button"
      onClick={onAbrir}
      className="group w-full text-left rounded-xl border border-border bg-card overflow-hidden hover:border-foreground/25 hover:shadow-sm transition-all"
    >
      <div className="relative aspect-square bg-muted/50 overflow-hidden">
        {pieza.cover_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={pieza.cover_url}
            alt={pieza.title}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
          />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Images size={22} />
          </span>
        )}

        <span
          className={`absolute top-2 left-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full ${networkChip(pieza.network)}`}
        >
          {networkLabel(pieza.network)}
        </span>

        {faltan > 0 && (
          <span className="absolute top-2 right-2 inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500 text-white">
            <AlertCircle size={10} />
            {faltan}
          </span>
        )}

        {pieza.imagenes > 1 && (
          <span className="absolute bottom-2 right-2 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-black/60 text-white">
            {pieza.imagenes}
          </span>
        )}
      </div>

      <div className="p-2.5 space-y-1">
        <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">{pieza.title}</p>
        <div className="flex items-center justify-between gap-2">
          <Estrellas valor={pieza.rating} />
          <span className="text-[11px] text-muted-foreground truncate">
            {pieza.status === 'publicado'
              ? fechaCorta(pieza.published_at)
              : pieza.scheduled_for
                ? fechaCorta(pieza.scheduled_for)
                : (pieza.format ?? '')}
          </span>
        </div>
      </div>
    </button>
  )
}

// ── Pantalla ─────────────────────────────────────────────────────────────────

export function ContenidosClient({ workspaceId, isManager, piezasIniciales }: Props) {
  const router = useRouter()
  const [piezas, setPiezas] = useState<Pieza[]>(piezasIniciales)
  const [filtro, setFiltro] = useState<string>('todas')
  const [abiertaId, setAbiertaId] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)

  const abierta = piezas.find((p) => p.id === abiertaId) ?? null

  const actualizar = useCallback((id: string, cambios: Partial<Pieza>) => {
    setPiezas((prev) => prev.map((p) => (p.id === id ? { ...p, ...cambios } : p)))
  }, [])

  const visibles = filtro === 'todas' ? piezas : piezas.filter((p) => p.network === filtro)

  // Solo se ofrecen como filtro las redes que de verdad tienen contenido: una
  // fila de nueve chips donde ocho estan vacios es ruido.
  const redesConContenido = CONTENT_NETWORKS.filter((n) => piezas.some((p) => p.network === n.key))

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <Images className="w-5 h-5 mt-0.5 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground leading-tight">Contenidos</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Lo que se va a publicar, en qué red y en qué punto va.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setCreando(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus size={16} />
          Nuevo contenido
        </button>
      </header>

      {redesConContenido.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setFiltro('todas')}
            className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
              filtro === 'todas'
                ? 'border-foreground/30 bg-accent text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            Todas
          </button>
          {redesConContenido.map((n) => (
            <button
              key={n.key}
              type="button"
              onClick={() => setFiltro(n.key)}
              className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                filtro === n.key
                  ? 'border-foreground/30 bg-accent text-foreground'
                  : 'border-border text-muted-foreground hover:text-foreground'
              }`}
            >
              {n.label}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {CONTENT_STATUSES.map((estado) => {
          const columna = visibles.filter((p) => p.status === estado.key)
          return (
            <section key={estado.key} className="space-y-3">
              <div className="flex items-center gap-2 px-0.5">
                <h2 className="text-sm font-semibold text-foreground">{estado.label}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{columna.length}</span>
              </div>

              {columna.length === 0 ? (
                <p className="text-xs text-muted-foreground border border-dashed border-border rounded-xl px-3 py-6 text-center">
                  {estado.vacio}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {columna.map((p) => (
                    <Ficha key={p.id} pieza={p} onAbrir={() => setAbiertaId(p.id)} />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>

      {creando && (
        <ModalNueva
          workspaceId={workspaceId}
          onCerrar={() => setCreando(false)}
          onCreada={(p) => {
            setPiezas((prev) => [p, ...prev])
            setCreando(false)
            setAbiertaId(p.id)
          }}
        />
      )}

      {abierta && (
        <PanelPieza
          pieza={abierta}
          isManager={isManager}
          onCerrar={() => setAbiertaId(null)}
          onCambio={actualizar}
          onBorrada={(id) => {
            setPiezas((prev) => prev.filter((p) => p.id !== id))
            setAbiertaId(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

// ── Modal: nueva pieza ───────────────────────────────────────────────────────

function ModalNueva({
  workspaceId,
  onCerrar,
  onCreada,
}: {
  workspaceId: string
  onCerrar: () => void
  onCreada: (p: Pieza) => void
}) {
  const [title, setTitle] = useState('')
  const [network, setNetwork] = useState(CONTENT_NETWORKS[0].key)
  const [format, setFormat] = useState(CONTENT_NETWORKS[0].formats[0])
  const [caption, setCaption] = useState('')
  const [scheduled, setScheduled] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const formatos = getNetwork(network)?.formats ?? []

  async function guardar() {
    if (!title.trim() || guardando) return
    setGuardando(true)
    setError(null)
    try {
      const res = await fetch('/api/content/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId,
          title,
          network,
          format,
          caption,
          scheduled_for: scheduled || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo crear')

      onCreada({
        id: data.item.id,
        title: data.item.title,
        caption: data.item.caption,
        network: data.item.network,
        format: data.item.format,
        status: 'por_aprobar',
        rating: null,
        scheduled_for: data.item.scheduled_for,
        published_at: null,
        published_url: null,
        autor: 'Tú',
        puedeBorrar: true,
        cover_url: null,
        cover_w: null,
        cover_h: null,
        imagenes: 0,
        correcciones: [],
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo crear')
      setGuardando(false)
    }
  }

  return (
    <Overlay onCerrar={onCerrar}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-lg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Nuevo contenido</h2>
          <button type="button" onClick={onCerrar} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="¿De qué es la pieza?"
            className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />

          <div className="flex gap-2">
            <select
              value={network}
              onChange={(e) => {
                setNetwork(e.target.value)
                setFormat(getNetwork(e.target.value)?.formats[0] ?? '')
              }}
              className="flex-1 px-2.5 py-2 text-sm border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {CONTENT_NETWORKS.map((n) => (
                <option key={n.key} value={n.key}>
                  {n.label}
                </option>
              ))}
            </select>

            <select
              value={format}
              onChange={(e) => setFormat(e.target.value)}
              className="flex-1 px-2.5 py-2 text-sm border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {formatos.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>

          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            rows={4}
            placeholder="Texto que acompaña la publicación (opcional)"
            className="w-full resize-none px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />

          <label className="block">
            <span className="text-xs text-muted-foreground">Se planea publicar el</span>
            <input
              type="date"
              value={scheduled}
              onChange={(e) => setScheduled(e.target.value)}
              className="mt-1 w-full px-3 py-2 text-sm border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </label>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            type="button"
            onClick={onCerrar}
            className="px-3 py-2 text-sm rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={guardar}
            disabled={!title.trim() || guardando}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          >
            {guardando && <Loader2 size={14} className="animate-spin" />}
            Crear y subir imágenes
          </button>
        </div>
      </div>
    </Overlay>
  )
}

// ── Panel de una pieza ───────────────────────────────────────────────────────

function PanelPieza({
  pieza,
  isManager,
  onCerrar,
  onCambio,
  onBorrada,
}: {
  pieza: Pieza
  isManager: boolean
  onCerrar: () => void
  onCambio: (id: string, cambios: Partial<Pieza>) => void
  onBorrada: (id: string) => void
}) {
  const [imagenes, setImagenes] = useState<ImagenCompleta[] | null>(null)
  const [cargandoImgs, setCargandoImgs] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nuevaCorreccion, setNuevaCorreccion] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [urlPublicada, setUrlPublicada] = useState(pieza.published_url ?? '')
  const fileRef = useRef<HTMLInputElement>(null)

  // Las versiones completas se piden UNA vez, al abrir. Va en un efecto y con
  // llave `pieza.id` por dos razones: pedirlas durante el render dispararia la
  // peticion dos veces en modo estricto (fuga de egress silenciosa), y cerrar el
  // panel antes de que conteste dejaria una respuesta buscando un componente que
  // ya no existe. `vivo` es esa cancelacion.
  useEffect(() => {
    if (pieza.imagenes === 0) {
      setImagenes([])
      return
    }
    let vivo = true
    setImagenes(null)
    setCargandoImgs(true)
    fetch(`/api/content/items/${pieza.id}/assets`)
      .then((r) => r.json())
      .then((d) => {
        if (vivo) setImagenes(d.assets ?? [])
      })
      .catch(() => {
        if (vivo) setImagenes([])
      })
      .finally(() => {
        if (vivo) setCargandoImgs(false)
      })
    return () => {
      vivo = false
    }
    // Solo la identidad de la pieza reabre la peticion. `pieza.imagenes` cambia
    // al subir o borrar una imagen, y esas dos acciones ya actualizan la lista
    // en memoria: volver a pedir el lote entero seria bajar todo otra vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieza.id])

  async function parchar(cambios: Record<string, unknown>, local: Partial<Pieza>) {
    setError(null)
    const res = await fetch(`/api/content/items/${pieza.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error ?? 'No se pudo guardar')
      return false
    }
    onCambio(pieza.id, local)
    return true
  }

  async function subir(files: FileList | null) {
    if (!files || files.length === 0) return
    setSubiendo(true)
    setError(null)
    try {
      for (const file of Array.from(files).slice(0, MAX_ASSETS_PER_ITEM)) {
        // La compresion ocurre AQUI, antes de que el archivo toque la red.
        const img = await prepareContentImage(file)
        const fd = new FormData()
        fd.append('full', new File([img.full], `f.${img.ext}`, { type: img.full.type }))
        fd.append('thumb', new File([img.thumb], `t.${img.ext}`, { type: img.thumb.type }))
        fd.append('width', String(img.width))
        fd.append('height', String(img.height))

        const res = await fetch(`/api/content/items/${pieza.id}/assets`, { method: 'POST', body: fd })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'No se pudo subir')

        setImagenes((prev) => [...(prev ?? []), { id: data.asset.id, url: data.asset.thumb_url, width: data.asset.width, height: data.asset.height }])
        onCambio(pieza.id, {
          imagenes: pieza.imagenes + 1,
          cover_url: pieza.cover_url ?? data.asset.thumb_url,
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo subir la imagen')
    } finally {
      setSubiendo(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function quitarImagen(id: string) {
    const res = await fetch(`/api/content/assets/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'No se pudo quitar la imagen')
      return
    }
    setImagenes((prev) => (prev ?? []).filter((i) => i.id !== id))
    onCambio(pieza.id, { imagenes: Math.max(0, pieza.imagenes - 1) })
  }

  async function pedirCorreccion() {
    const cuerpo = nuevaCorreccion.trim()
    if (!cuerpo || enviando) return
    setEnviando(true)
    setError(null)
    try {
      const res = await fetch(`/api/content/items/${pieza.id}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: cuerpo, kind: 'correccion' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar')

      onCambio(pieza.id, {
        correcciones: [
          ...pieza.correcciones,
          {
            id: data.note.id,
            body: cuerpo,
            kind: 'correccion',
            resolved_at: null,
            created_at: data.note.created_at,
            autor: 'Tú',
          },
        ],
        // La API regresa a revision una pieza aprobada sobre la que se pide una
        // correccion. Se refleja aqui para no mentirle a quien lo acaba de hacer.
        ...(data.status ? { status: data.status as ContentStatus } : {}),
      })
      setNuevaCorreccion('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar')
    } finally {
      setEnviando(false)
    }
  }

  async function alternarCorreccion(c: Correccion) {
    const resolver = !c.resolved_at
    const res = await fetch(`/api/content/notes/${c.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolved: resolver }),
    })
    if (!res.ok) return
    onCambio(pieza.id, {
      correcciones: pieza.correcciones.map((x) =>
        x.id === c.id ? { ...x, resolved_at: resolver ? new Date().toISOString() : null } : x,
      ),
    })
  }

  async function borrar() {
    if (!confirm('¿Borrar esta pieza y sus imágenes? No se puede deshacer.')) return
    const res = await fetch(`/api/content/items/${pieza.id}`, { method: 'DELETE' })
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      setError(d.error ?? 'No se pudo borrar')
      return
    }
    onBorrada(pieza.id)
  }

  const faltan = pendientes(pieza)

  return (
    <Overlay onCerrar={onCerrar}>
      <div className="w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-xl border border-border bg-card shadow-lg">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 py-3 border-b border-border bg-card">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${networkChip(pieza.network)}`}>
                {networkLabel(pieza.network)}
              </span>
              {pieza.format && <span className="text-[11px] text-muted-foreground">{pieza.format}</span>}
            </div>
            <h2 className="text-base font-semibold text-foreground leading-tight mt-1 truncate">{pieza.title}</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Subido por {pieza.autor}
              {pieza.scheduled_for ? ` · se publica el ${fechaCorta(pieza.scheduled_for)}` : ''}
            </p>
          </div>
          <button type="button" onClick={onCerrar} className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent flex-shrink-0">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* ── Imágenes ── */}
          <section className="space-y-2">
            {cargandoImgs && (
              <div className="grid grid-cols-3 gap-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="aspect-square rounded-lg bg-muted/60 animate-pulse" />
                ))}
              </div>
            )}

            {imagenes && imagenes.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {imagenes.map((img) => (
                  <div key={img.id} className="relative group rounded-lg overflow-hidden border border-border bg-muted/40">
                    {img.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={img.url} alt="" loading="lazy" className="w-full aspect-square object-cover" />
                    ) : (
                      <div className="w-full aspect-square flex items-center justify-center text-muted-foreground">
                        <Images size={18} />
                      </div>
                    )}
                    {pieza.status !== 'publicado' && (
                      <button
                        type="button"
                        onClick={() => quitarImagen(img.id)}
                        title="Quitar imagen"
                        className="absolute top-1 right-1 p-1 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <X size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {pieza.status !== 'publicado' && (
              <>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => subir(e.target.files)}
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={subiendo || pieza.imagenes >= MAX_ASSETS_PER_ITEM}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-dashed border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
                >
                  {subiendo ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                  {subiendo ? 'Comprimiendo y subiendo...' : 'Agregar imágenes'}
                </button>
              </>
            )}
          </section>

          {/* ── Copy y calificación ── */}
          <section className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Texto de la publicación</label>
            <textarea
              defaultValue={pieza.caption ?? ''}
              rows={4}
              onBlur={(e) => {
                const v = e.target.value
                if (v !== (pieza.caption ?? '')) parchar({ caption: v }, { caption: v || null })
              }}
              placeholder="Escribe aquí el copy que se va a publicar."
              className="w-full resize-none px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">Calificación:</span>
              <Estrellas
                valor={pieza.rating}
                size={18}
                onChange={(v) => parchar({ rating: v }, { rating: v })}
              />
            </div>
          </section>

          {/* ── Correcciones ── */}
          <section className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">Correcciones</h3>
              {faltan > 0 && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-400">
                  {faltan} sin atender
                </span>
              )}
            </div>

            {pieza.correcciones.length > 0 && (
              <ul className="space-y-1.5">
                {pieza.correcciones.map((c) => (
                  <li
                    key={c.id}
                    className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${
                      c.resolved_at ? 'border-border bg-muted/30' : 'border-amber-500/30 bg-amber-500/5'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => alternarCorreccion(c)}
                      title={c.resolved_at ? 'Volver a abrir' : 'Marcar atendida'}
                      className={`mt-0.5 w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${
                        c.resolved_at
                          ? 'bg-emerald-500 border-emerald-500 text-white'
                          : 'border-muted-foreground/40 hover:border-foreground'
                      }`}
                    >
                      {c.resolved_at && <Check size={10} />}
                    </button>
                    <div className="min-w-0">
                      <p className={`text-sm ${c.resolved_at ? 'text-muted-foreground line-through' : 'text-foreground'}`}>
                        {c.body}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{c.autor}</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex gap-2">
              <input
                value={nuevaCorreccion}
                onChange={(e) => setNuevaCorreccion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') pedirCorreccion()
                }}
                placeholder="¿Qué hay que corregir?"
                className="flex-1 px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={pedirCorreccion}
                disabled={!nuevaCorreccion.trim() || enviando}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <MessageSquarePlus size={14} />
                Pedir
              </button>
            </div>
          </section>

          {/* ── Enlace de lo publicado ── */}
          {pieza.status === 'publicado' && (
            <section className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Dónde salió</label>
              <div className="flex gap-2">
                <input
                  value={urlPublicada}
                  onChange={(e) => setUrlPublicada(e.target.value)}
                  onBlur={() => {
                    if (urlPublicada !== (pieza.published_url ?? '')) {
                      parchar({ published_url: urlPublicada }, { published_url: urlPublicada || null })
                    }
                  }}
                  placeholder="https://..."
                  className="flex-1 px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {pieza.published_url && (
                  <a
                    href={pieza.published_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center px-3 py-2 rounded-lg border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            </section>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {/* ── Acciones de estado ── */}
        <div className="sticky bottom-0 flex flex-wrap items-center gap-2 px-4 py-3 border-t border-border bg-card">
          {pieza.puedeBorrar && (
            <button
              type="button"
              onClick={borrar}
              className="inline-flex items-center gap-1.5 px-2.5 py-2 text-sm rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <Trash2 size={14} />
              Borrar
            </button>
          )}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!isManager && pieza.status !== 'publicado' && (
              <span className="text-[11px] text-muted-foreground">
                Aprobar y publicar lo hace un administrador.
              </span>
            )}

            {isManager && pieza.status !== 'por_aprobar' && (
              <button
                type="button"
                onClick={() => parchar({ status: 'por_aprobar' }, { status: 'por_aprobar', published_at: null, published_url: null })}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-input text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <Undo2 size={14} />
                Regresar a revisión
              </button>
            )}

            {isManager && pieza.status === 'por_aprobar' && (
              <button
                type="button"
                onClick={() => parchar({ status: 'aprobado' }, { status: 'aprobado' })}
                disabled={faltan > 0}
                title={faltan > 0 ? 'Primero hay que atender las correcciones pendientes' : undefined}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
              >
                <Check size={14} />
                Aprobar
              </button>
            )}

            {isManager && pieza.status === 'aprobado' && (
              <button
                type="button"
                onClick={() =>
                  parchar(
                    { status: 'publicado', published_url: urlPublicada || null },
                    { status: 'publicado', published_at: new Date().toISOString(), published_url: urlPublicada || null },
                  )
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Check size={14} />
                Marcar publicado
              </button>
            )}
          </div>
        </div>
      </div>
    </Overlay>
  )
}

// ── Capa oscura compartida ───────────────────────────────────────────────────

function Overlay({ children, onCerrar }: { children: React.ReactNode; onCerrar: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      // Cerrar al tocar fuera, pero solo si el clic empezo y termino en la capa:
      // si no, arrastrar el cursor desde un campo de texto hasta el borde cierra
      // el panel y se pierde lo que se estaba escribiendo.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCerrar()
      }}
    >
      {children}
    </div>
  )
}

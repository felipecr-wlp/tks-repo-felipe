'use client'

/**
 * Tablero de solicitudes: cuatro columnas, una ficha por petición, un panel al
 * abrirla.
 *
 * El objetivo de diseño es que nadie tenga que preguntar "¿en qué quedó lo que
 * pedí?". Por eso la ficha dice de un golpe quién lo pidió, a qué departamento
 * va, qué tan urgente es y para cuándo se necesita; y el panel muestra la
 * decisión escrita, no solo el color del estado.
 *
 * ── Los botones que no te tocan, no se dibujan ──────────────────────────────
 * Qué acciones puede hacer esta persona lo decide `evaluarAccion`, la MISMA
 * función que corre el servidor. Aquí solo sirve para no ofrecer un botón que
 * va a fallar; el permiso de verdad se revisa allá. Duplicar la regla en un
 * `if` local sería empezar a tener dos versiones de quién manda.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Plus, X, Loader2, Paperclip, Link2, MessageSquare, Send, Users,
  CornerDownRight, Download, CalendarClock, Building2, ChevronDown, Inbox,
  Wrench, Code2, ShoppingCart, KeyRound, PenTool, FileText, LifeBuoy, CircleHelp,
} from 'lucide-react'
import { createClient as createSupabaseClient } from '@/lib/supabase/client'
import {
  TIPOS_SOLICITUD, tipoDeSolicitud, PRIORIDADES, PESO_PRIORIDAD,
  estadoInfo, COLUMNAS, type Prioridad,
} from '@/lib/tickets/catalogo'
import {
  evaluarAccion, TRANSICIONES, estaCerrada,
  type AccionSolicitud, type EstadoSolicitud,
} from '@/lib/tickets/flujo-solicitud'
import {
  TICKET_FILES_MAX_SIZE, TICKET_FILES_MIME_ALLOWLIST, normalizaMime,
  esUrlSegura, type Adjunto, type Enlace,
} from '@/lib/tickets/archivos'

// ── Tipos que viajan del servidor ────────────────────────────────────────────

export interface Persona {
  id: string
  nombre: string
  avatar_url: string | null
}

export interface Departamento {
  id: string
  name: string
  color: string | null
  icon: string | null
}

export interface Solicitud {
  id: string
  numero: number
  title: string
  body: string | null
  kind: string
  priority: string
  status: string
  space_id: string | null
  space_name: string | null
  space_color: string | null
  requested_by: string | null
  solicitante: string
  assignee_id: string | null
  responsable: string | null
  needed_by: string | null
  due_date: string | null
  decision_note: string | null
  created_at: string
  closed_at: string | null
  links: Enlace[]
  attachments: Adjunto[]
}

interface Autor {
  id: string
  display_name: string
  avatar_url: string | null
}

interface Comentario {
  id: string
  parent_id: string | null
  body: string
  attachments: unknown
  is_system: boolean
  created_at: string
  edited_at: string | null
  autor: Autor | null
}

interface Detalle {
  comentarios: Comentario[]
  involucrados: { profile_id: string; perfil: Autor | null }[]
  yo: { esSolicitante: boolean; esResponsable: boolean; esAdmin: boolean }
}

interface Props {
  workspaceId: string
  workspaceSlug: string
  currentUserId: string
  soyMando: boolean
  solicitudesIniciales: Solicitud[]
  departamentos: Departamento[]
  personas: Persona[]
  /** Id que llega por ?s= desde la bandeja: se abre solo. */
  abrirId: string | null
}

// ── Iconos del catalogo ──────────────────────────────────────────────────────
// Mapa explicito y no import dinamico: son ocho, y resolverlos por nombre en
// tiempo de ejecucion se lleva el arbol entero de lucide al bundle.
const ICONOS: Record<string, typeof Wrench> = {
  Wrench, Code2, ShoppingCart, KeyRound, PenTool, FileText, LifeBuoy, CircleHelp,
}

function IconoTipo({ kind, size = 14 }: { kind: string; size?: number }) {
  const Cmp = ICONOS[tipoDeSolicitud(kind).icon] ?? CircleHelp
  return <Cmp size={size} />
}

// ── Fechas ───────────────────────────────────────────────────────────────────

function fechaCorta(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  return d.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })
}

function cuandoRelativo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (min < 1) return 'ahora'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d < 30) return `hace ${d} d`
  return fechaCorta(iso)
}

/** ¿La fecha en que se necesita ya pasó, o es hoy? */
function vencida(needed: string | null): boolean {
  if (!needed) return false
  const hoy = new Date().toISOString().slice(0, 10)
  return needed < hoy
}

// ── Pantalla ─────────────────────────────────────────────────────────────────

export function SolicitudesClient({
  workspaceSlug, currentUserId, soyMando,
  solicitudesIniciales, departamentos, personas, abrirId,
}: Props) {
  const router = useRouter()
  const [solicitudes, setSolicitudes] = useState(solicitudesIniciales)
  const [abierta, setAbierta] = useState<string | null>(abrirId)
  const [creando, setCreando] = useState(false)
  const [soloMias, setSoloMias] = useState(false)
  const [verCerradas, setVerCerradas] = useState(false)

  useEffect(() => { setSolicitudes(solicitudesIniciales) }, [solicitudesIniciales])

  const refrescar = useCallback(() => { router.refresh() }, [router])

  const visibles = useMemo(() => {
    const base = soloMias
      ? solicitudes.filter(
          (s) => s.requested_by === currentUserId || s.assignee_id === currentUserId,
        )
      : solicitudes
    // Orden dentro de cada columna: primero lo urgente, y a igual urgencia lo
    // que se pidió antes. Ordenar solo por fecha esconde lo urgente al fondo.
    return [...base].sort((a, b) => {
      const pa = PESO_PRIORIDAD[a.priority as Prioridad] ?? 2
      const pb = PESO_PRIORIDAD[b.priority as Prioridad] ?? 2
      if (pa !== pb) return pa - pb
      return a.created_at < b.created_at ? -1 : 1
    })
  }, [solicitudes, soloMias, currentUserId])

  const cerradas = visibles.filter((s) => s.status === 'rechazado' || s.status === 'cancelado')
  const detalle = solicitudes.find((s) => s.id === abierta) ?? null

  return (
    <div className="flex h-full flex-col">
      {/* Encabezado */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">Solicitudes</h1>
          <p className="text-sm text-muted-foreground">
            Pide algo a un departamento o a la dirección. Cada solicitud se canaliza o se
            rechaza con el motivo escrito.
          </p>
        </div>

        <label className="flex cursor-pointer select-none items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={soloMias}
            onChange={(e) => setSoloMias(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          Solo las mías
        </label>

        <button
          onClick={() => setCreando(true)}
          className="flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Plus size={16} />
          Nueva solicitud
        </button>
      </div>

      {/* Tablero */}
      <div className="flex-1 overflow-x-auto p-4">
        {visibles.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <Inbox size={40} className="text-muted-foreground/40" />
            <div>
              <p className="font-medium">Todavía no hay solicitudes</p>
              <p className="max-w-md text-sm text-muted-foreground">
                Lo que hoy se pide por chat y se pierde, aquí queda con número, responsable
                y una decisión escrita.
              </p>
            </div>
            <button
              onClick={() => setCreando(true)}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
            >
              Levantar la primera
            </button>
          </div>
        ) : (
          <div className="grid min-w-[900px] grid-cols-4 gap-4">
            {COLUMNAS.map((col) => {
              const items = visibles.filter((s) => s.status === col.key)
              return (
                <div key={col.key} className="flex min-w-0 flex-col">
                  <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
                    <span className="text-sm font-medium">{col.label}</span>
                    <span className="text-xs text-muted-foreground">{items.length}</span>
                  </div>
                  <p className="mb-2 px-1 text-xs leading-snug text-muted-foreground/80">
                    {col.explica}
                  </p>
                  <div className="flex flex-col gap-2">
                    {items.map((s) => (
                      <Ficha key={s.id} s={s} onAbrir={() => setAbierta(s.id)} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Cerradas sin resolver: se guardan pero no ocupan el tablero. */}
        {cerradas.length > 0 && (
          <div className="mt-6 border-t border-border pt-4">
            <button
              onClick={() => setVerCerradas((v) => !v)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
            >
              <ChevronDown
                size={14}
                className={verCerradas ? 'rotate-0' : '-rotate-90'}
              />
              Rechazadas y canceladas ({cerradas.length})
            </button>
            {verCerradas && (
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {cerradas.map((s) => (
                  <Ficha key={s.id} s={s} onAbrir={() => setAbierta(s.id)} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {creando && (
        <PanelNueva
          departamentos={departamentos}
          onCerrar={() => setCreando(false)}
          onCreada={() => { setCreando(false); refrescar() }}
        />
      )}

      {detalle && (
        <PanelDetalle
          key={detalle.id}
          s={detalle}
          personas={personas}
          departamentos={departamentos}
          currentUserId={currentUserId}
          soyMando={soyMando}
          workspaceSlug={workspaceSlug}
          onCerrar={() => setAbierta(null)}
          onCambio={refrescar}
        />
      )}
    </div>
  )
}

// ── Ficha ────────────────────────────────────────────────────────────────────

function Ficha({ s, onAbrir }: { s: Solicitud; onAbrir: () => void }) {
  const tipo = tipoDeSolicitud(s.kind)
  const prio = PRIORIDADES.find((p) => p.key === s.priority)
  const urge = vencida(s.needed_by) && !estaCerrada(s.status as EstadoSolicitud)

  return (
    <button
      onClick={onAbrir}
      className="w-full rounded-lg border border-border bg-card p-3 text-left transition hover:border-foreground/20 hover:shadow-sm"
    >
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-mono">#{s.numero}</span>
        <span className="flex items-center gap-1">
          <IconoTipo kind={s.kind} size={12} />
          {tipo.label}
        </span>
        {prio && prio.key !== 'normal' && (
          <span className={`ml-auto font-medium ${prio.clase}`}>{prio.label}</span>
        )}
      </div>

      <p className="mb-2 line-clamp-2 text-sm font-medium leading-snug">{s.title}</p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {s.space_name && (
          <span className="flex items-center gap-1">
            <Building2 size={11} />
            {s.space_name}
          </span>
        )}
        {s.needed_by && (
          <span className={`flex items-center gap-1 ${urge ? 'text-red-600 dark:text-red-400' : ''}`}>
            <CalendarClock size={11} />
            {fechaCorta(s.needed_by)}
          </span>
        )}
        {s.attachments.length > 0 && (
          <span className="flex items-center gap-1">
            <Paperclip size={11} />
            {s.attachments.length}
          </span>
        )}
        {s.links.length > 0 && (
          <span className="flex items-center gap-1">
            <Link2 size={11} />
            {s.links.length}
          </span>
        )}
      </div>

      <p className="mt-2 truncate text-xs text-muted-foreground/70">
        {s.solicitante}
        {s.responsable ? ` · a cargo: ${s.responsable}` : ''}
      </p>
    </button>
  )
}

// ── Nueva solicitud ──────────────────────────────────────────────────────────

function PanelNueva({
  departamentos, onCerrar, onCreada,
}: {
  departamentos: Departamento[]
  onCerrar: () => void
  onCreada: () => void
}) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState('software')
  const [priority, setPriority] = useState<Prioridad>('normal')
  const [spaceId, setSpaceId] = useState('')
  const [neededBy, setNeededBy] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [links, setLinks] = useState<Enlace[]>([])
  const [guardando, setGuardando] = useState(false)

  function agregarEnlace() {
    const url = linkUrl.trim()
    if (!url) return
    if (!esUrlSegura(url)) {
      toast.error('Solo se aceptan enlaces http o https')
      return
    }
    // `label` vacío y no ausente: `leerEnlaces` garantiza que siempre venga la
    // propiedad, y al pintar se resuelve con `l.label || l.url`. Dejarla fuera
    // rompía el tipo y obligaba a preguntar por `undefined` en cada uso.
    setLinks((l) => [...l, { url, label: '' }])
    setLinkUrl('')
  }

  async function enviar() {
    if (title.trim().length < 3) {
      toast.error('Ponle un título a la solicitud')
      return
    }
    setGuardando(true)
    try {
      const res = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim() || null,
          kind,
          priority,
          spaceId: spaceId || null,
          needed_by: neededBy || null,
          links,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo enviar')
      toast.success(`Solicitud #${data.numero ?? ''} enviada`.trim())
      onCreada()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo enviar')
    } finally {
      setGuardando(false)
    }
  }

  const ejemplo = tipoDeSolicitud(kind).ejemplo

  return (
    <Overlay onCerrar={onCerrar}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-semibold">Nueva solicitud</h2>
          <button onClick={onCerrar} className="rounded p-1 hover:bg-accent">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <Campo label="¿Qué necesitas?">
            <input
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              placeholder="Una línea. Ej: el reporte de nómina no cuadra las horas extra"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Campo>

          <Campo label="Tipo">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {TIPOS_SOLICITUD.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setKind(t.key)}
                  className={`flex items-center gap-2 rounded-md border px-2 py-2 text-xs ${
                    kind === t.key
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  <IconoTipo kind={t.key} size={14} />
                  <span className="truncate">{t.label}</span>
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{ejemplo}</p>
          </Campo>

          <Campo label="Detalle">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              maxLength={10000}
              placeholder="Qué pasa hoy, qué esperarías que pasara, y por qué importa. Entre más claro, menos vueltas."
              className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Campo>

          <div className="grid gap-4 sm:grid-cols-3">
            <Campo label="¿A quién va?">
              <select
                value={spaceId}
                onChange={(e) => setSpaceId(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <option value="">A la dirección</option>
                {departamentos.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </Campo>

            <Campo label="Urgencia">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value as Prioridad)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {PRIORIDADES.map((p) => (
                  <option key={p.key} value={p.key}>{p.label}</option>
                ))}
              </select>
            </Campo>

            <Campo label="La necesito para">
              <input
                type="date"
                value={neededBy}
                onChange={(e) => setNeededBy(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </Campo>
          </div>

          <Campo label="Enlaces (opcional)">
            <div className="flex gap-2">
              <input
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); agregarEnlace() } }}
                placeholder="https://..."
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              <button
                onClick={agregarEnlace}
                className="rounded-md border border-border px-3 text-sm hover:bg-accent"
              >
                Agregar
              </button>
            </div>
            {links.length > 0 && (
              <ul className="mt-2 space-y-1">
                {links.map((l, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Link2 size={12} />
                    <span className="truncate">{l.url}</span>
                    <button
                      onClick={() => setLinks((prev) => prev.filter((_, j) => j !== i))}
                      className="ml-auto rounded p-0.5 hover:bg-accent"
                    >
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Los archivos se adjuntan al abrir la solicitud, ya con su número.
            </p>
          </Campo>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button onClick={onCerrar} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">
            Cancelar
          </button>
          <button
            onClick={enviar}
            disabled={guardando}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {guardando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Enviar solicitud
          </button>
        </div>
      </div>
    </Overlay>
  )
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  )
}

// ── Detalle ──────────────────────────────────────────────────────────────────

function PanelDetalle({
  s, personas, departamentos, currentUserId, soyMando, onCerrar, onCambio,
}: {
  s: Solicitud
  personas: Persona[]
  departamentos: Departamento[]
  currentUserId: string
  soyMando: boolean
  workspaceSlug: string
  onCerrar: () => void
  onCambio: () => void
}) {
  const [detalle, setDetalle] = useState<Detalle | null>(null)
  const [cargando, setCargando] = useState(true)
  const [accionAbierta, setAccionAbierta] = useState<AccionSolicitud | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/tickets/${s.id}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo abrir')
      setDetalle(data)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo abrir')
    } finally {
      setCargando(false)
    }
  }, [s.id])

  useEffect(() => { cargar() }, [cargar])

  const yo = detalle?.yo ?? {
    esSolicitante: s.requested_by === currentUserId,
    esResponsable: s.assignee_id === currentUserId,
    esAdmin: soyMando,
  }

  // Qué acciones ofrecer. Se pregunta a la MISMA tabla que usa el servidor, con
  // las exigencias en true: aquí solo interesa si el rol y el estado dan; lo que
  // falte (nota, destino) lo pide el formulario de la acción.
  const acciones = (Object.keys(TRANSICIONES) as AccionSolicitud[]).filter((a) =>
    evaluarAccion({
      accion: a,
      estadoActual: s.status as EstadoSolicitud,
      esSolicitante: yo.esSolicitante,
      esResponsable: yo.esResponsable,
      esAdmin: yo.esAdmin,
      tieneNota: true,
      tieneDestino: true,
    }).ok,
  )

  // ── Adjuntar ───────────────────────────────────────────────────────────────
  const subir = useCallback(
    async (files: FileList | File[]) => {
      const lista = Array.from(files)
      if (lista.length === 0) return
      setSubiendo(true)
      const supabase = createSupabaseClient()

      for (const file of lista) {
        try {
          if (file.size > TICKET_FILES_MAX_SIZE) {
            throw new Error(`${file.name} pasa de 50MB. Comprímelo en un ZIP.`)
          }
          const mime = normalizaMime(file.name, file.type)
          if (!TICKET_FILES_MIME_ALLOWLIST.has(mime)) {
            throw new Error(`${file.name}: ese tipo no se puede adjuntar. Comprímelo en un ZIP.`)
          }

          const firmaRes = await fetch(`/api/tickets/${s.id}/files/upload-url`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: file.name, mime, size: file.size }),
          })
          const firma = await firmaRes.json()
          if (!firmaRes.ok) throw new Error(firma.error ?? 'No se pudo preparar la subida')

          const { error: upErr } = await supabase.storage
            .from(firma.bucket as string)
            .uploadToSignedUrl(firma.path as string, firma.token as string, file, {
              contentType: firma.mime as string,
            })
          if (upErr) throw new Error(upErr.message)

          const regRes = await fetch(`/api/tickets/${s.id}/files`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: firma.path, name: firma.name, mime: firma.mime }),
          })
          const reg = await regRes.json()
          if (!regRes.ok) throw new Error(reg.error ?? 'No se pudo registrar el archivo')
        } catch (e) {
          toast.error(e instanceof Error ? e.message : 'No se pudo subir')
        }
      }
      setSubiendo(false)
      onCambio()
    },
    [s.id, onCambio],
  )

  async function descargar(a: Adjunto) {
    try {
      const res = await fetch(`/api/tickets/${s.id}/files?path=${encodeURIComponent(a.path)}`)
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo abrir el archivo')
      window.open(data.url as string, '_blank', 'noopener,noreferrer')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo abrir el archivo')
    }
  }

  const info = estadoInfo(s.status as EstadoSolicitud)
  const tipo = tipoDeSolicitud(s.kind)

  return (
    <Overlay onCerrar={onCerrar}>
      <div className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl">
        {/* Cabecera */}
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">#{s.numero}</span>
              <span className="flex items-center gap-1">
                <IconoTipo kind={s.kind} size={12} />
                {tipo.label}
              </span>
              <span className={`rounded-full border px-2 py-0.5 ${info.clase}`}>{info.label}</span>
              {s.space_name && (
                <span className="flex items-center gap-1">
                  <Building2 size={11} />
                  {s.space_name}
                </span>
              )}
            </div>
            <h2 className="text-base font-semibold leading-snug">{s.title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {s.solicitante} · {cuandoRelativo(s.created_at)}
              {s.responsable ? ` · a cargo: ${s.responsable}` : ''}
            </p>
          </div>
          <button onClick={onCerrar} className="rounded p-1 hover:bg-accent">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="grid gap-0 lg:grid-cols-[1fr_280px]">
            {/* Columna principal */}
            <div className="min-w-0 space-y-5 p-5">
              {s.body && (
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{s.body}</p>
              )}

              {/* La decisión, escrita. Es el corazón del módulo: sin esto, un
                  estado de color no le explica nada a quien pidió algo. */}
              {s.decision_note && (
                <div className="rounded-md border border-border bg-muted/40 p-3">
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Decisión</p>
                  <p className="whitespace-pre-wrap text-sm">{s.decision_note}</p>
                </div>
              )}

              {s.links.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted-foreground">Enlaces</p>
                  <ul className="space-y-1">
                    {s.links.map((l, i) => (
                      <li key={i}>
                        <a
                          href={l.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 text-sm text-primary hover:underline"
                        >
                          <Link2 size={13} />
                          <span className="truncate">{l.label || l.url}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <p className="text-xs font-medium text-muted-foreground">Archivos</p>
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={subiendo}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    {subiendo ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />}
                    Adjuntar
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    multiple
                    hidden
                    onChange={(e) => { if (e.target.files) subir(e.target.files); e.target.value = '' }}
                  />
                </div>
                {s.attachments.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70">
                    ZIP, RAR, 7z, imágenes, PDF y documentos. Hasta 50MB cada uno.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {s.attachments.map((a, i) => (
                      <li key={i}>
                        <button
                          onClick={() => descargar(a)}
                          className="flex w-full items-center gap-2 rounded border border-border px-2 py-1.5 text-left text-sm hover:bg-accent"
                        >
                          <Download size={13} className="shrink-0 text-muted-foreground" />
                          <span className="truncate">{a.name}</span>
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                            {(a.size / 1024 / 1024).toFixed(1)} MB
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Hilo */}
              <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                  <MessageSquare size={12} />
                  Conversación
                </p>
                {cargando ? (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 size={14} className="animate-spin" />
                    Cargando el hilo
                  </div>
                ) : (
                  <Hilo
                    comentarios={detalle?.comentarios ?? []}
                    ticketId={s.id}
                    onCambio={() => { cargar(); onCambio() }}
                  />
                )}
              </div>
            </div>

            {/* Barra lateral */}
            <div className="space-y-5 border-t border-border p-5 lg:border-l lg:border-t-0">
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Acciones</p>
                {acciones.length === 0 ? (
                  <p className="text-xs text-muted-foreground/70">
                    Ahora mismo no hay nada que puedas mover aquí.
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {acciones.map((a) => (
                      <button
                        key={a}
                        onClick={() => setAccionAbierta(a)}
                        className="rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        {ETIQUETA_ACCION[a]}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <Fechas s={s} />

              <Involucrados
                ticketId={s.id}
                involucrados={detalle?.involucrados ?? []}
                personas={personas}
                currentUserId={currentUserId}
                puedeInvolucrar={yo.esSolicitante || yo.esResponsable || yo.esAdmin}
                onCambio={() => { cargar(); onCambio() }}
              />
            </div>
          </div>
        </div>
      </div>

      {accionAbierta && (
        <FormularioAccion
          accion={accionAbierta}
          s={s}
          personas={personas}
          departamentos={departamentos}
          onCerrar={() => setAccionAbierta(null)}
          onHecho={() => { setAccionAbierta(null); onCambio(); cargar() }}
        />
      )}
    </Overlay>
  )
}

const ETIQUETA_ACCION: Record<AccionSolicitud, string> = {
  editar: 'Editar la solicitud',
  canalizar: 'Canalizar a alguien',
  rechazar: 'Rechazar con motivo',
  arrancar: 'Empezar a trabajarla',
  resolver: 'Marcar resuelta',
  cancelar: 'Cancelar mi solicitud',
  reabrir: 'Reabrir',
}

function Fechas({ s }: { s: Solicitud }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">Fechas</p>
      <dl className="space-y-1.5 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Se pidió</dt>
          <dd>{fechaCorta(s.created_at)}</dd>
        </div>
        {/* Las dos fechas son distintas a propósito: una es lo que pide quien
            pide, la otra lo que promete quien hace. Juntarlas en un solo campo
            borra justo la diferencia que hay que negociar. */}
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">La necesitan</dt>
          <dd className={vencida(s.needed_by) ? 'text-red-600 dark:text-red-400' : ''}>
            {s.needed_by ? fechaCorta(s.needed_by) : 'sin fecha'}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Comprometida</dt>
          <dd>{s.due_date ? fechaCorta(s.due_date) : 'sin fecha'}</dd>
        </div>
      </dl>
    </div>
  )
}

// ── Involucrados ─────────────────────────────────────────────────────────────

function Involucrados({
  ticketId, involucrados, personas, currentUserId, puedeInvolucrar, onCambio,
}: {
  ticketId: string
  involucrados: { profile_id: string; perfil: Autor | null }[]
  personas: Persona[]
  currentUserId: string
  puedeInvolucrar: boolean
  onCambio: () => void
}) {
  const [agregando, setAgregando] = useState(false)
  const yaEstan = new Set(involucrados.map((i) => i.profile_id))

  async function mover(profileId: string, metodo: 'POST' | 'DELETE') {
    try {
      const res = await fetch(`/api/tickets/${ticketId}/watchers`, {
        method: metodo,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo')
      onCambio()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo')
    } finally {
      setAgregando(false)
    }
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Users size={12} />
          Involucrados
        </p>
        {puedeInvolucrar && (
          <button
            onClick={() => setAgregando((v) => !v)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {agregando ? 'Cerrar' : 'Sumar'}
          </button>
        )}
      </div>

      {involucrados.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">
          Nadie más. Quien la pidió, quien está a cargo y los administradores la ven siempre.
        </p>
      ) : (
        <ul className="space-y-1">
          {involucrados.map((i) => (
            <li key={i.profile_id} className="flex items-center gap-2 text-sm">
              <span className="truncate">{i.perfil?.display_name ?? 'Alguien'}</span>
              {(puedeInvolucrar || i.profile_id === currentUserId) && (
                <button
                  onClick={() => mover(i.profile_id, 'DELETE')}
                  className="ml-auto rounded p-0.5 text-muted-foreground hover:bg-accent"
                  title={i.profile_id === currentUserId ? 'Salirme' : 'Quitar'}
                >
                  <X size={12} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {agregando && (
        <select
          className="mt-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
          defaultValue=""
          onChange={(e) => { if (e.target.value) mover(e.target.value, 'POST') }}
        >
          <option value="">Elige a alguien</option>
          {personas
            .filter((p) => !yaEstan.has(p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>{p.nombre}</option>
            ))}
        </select>
      )}
    </div>
  )
}

// ── Hilo de comentarios ──────────────────────────────────────────────────────

function Hilo({
  comentarios, ticketId, onCambio,
}: {
  comentarios: Comentario[]
  ticketId: string
  onCambio: () => void
}) {
  const [texto, setTexto] = useState('')
  const [respondiendoA, setRespondiendoA] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  // Un solo nivel de anidamiento, a propósito. Con dos ya nadie sabe a qué se
  // está respondiendo y el hilo deja de leerse en orden, que es justo lo que se
  // vino a arreglar del chat.
  const raiz = comentarios.filter((c) => !c.parent_id)
  const hijosDe = new Map<string, Comentario[]>()
  for (const c of comentarios) {
    if (!c.parent_id) continue
    const l = hijosDe.get(c.parent_id) ?? []
    l.push(c)
    hijosDe.set(c.parent_id, l)
  }

  async function enviar() {
    const body = texto.trim()
    if (!body) return
    setEnviando(true)
    try {
      const res = await fetch(`/api/tickets/${ticketId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, parentId: respondiendoA }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo comentar')
      setTexto('')
      setRespondiendoA(null)
      onCambio()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo comentar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <div className="space-y-3">
      {raiz.length === 0 && (
        <p className="text-xs text-muted-foreground/70">
          Todavía no hay comentarios. Aquí es donde se aclara lo que falte.
        </p>
      )}

      {raiz.map((c) => (
        <div key={c.id}>
          <Burbuja c={c} onResponder={() => setRespondiendoA(c.id)} />
          {(hijosDe.get(c.id) ?? []).map((h) => (
            <div key={h.id} className="ml-6 mt-2 border-l border-border pl-3">
              <Burbuja c={h} onResponder={() => setRespondiendoA(c.id)} />
            </div>
          ))}
        </div>
      ))}

      <div className="pt-1">
        {respondiendoA && (
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <CornerDownRight size={12} />
            Respondiendo en el hilo
            <button
              onClick={() => setRespondiendoA(null)}
              className="rounded p-0.5 hover:bg-accent"
            >
              <X size={11} />
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              // Enter manda, Shift+Enter hace salto. Es lo que la gente ya espera
              // del chat de donde viene.
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar() }
            }}
            rows={2}
            maxLength={5000}
            placeholder="Escribe un comentario. Enter envía."
            className="flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            onClick={enviar}
            disabled={enviando || !texto.trim()}
            className="self-end rounded-md bg-primary px-3 py-2 text-primary-foreground hover:opacity-90 disabled:opacity-40"
          >
            {enviando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </button>
        </div>
      </div>
    </div>
  )
}

function Burbuja({ c, onResponder }: { c: Comentario; onResponder: () => void }) {
  // Los movimientos del flujo viven en el MISMO hilo que la conversación, solo
  // que en gris y sin burbuja. Partirlos en dos listas es como se pierde el
  // contexto de por qué se decidió algo.
  if (c.is_system) {
    return (
      <p className="py-1 text-xs italic text-muted-foreground">
        {c.autor?.display_name ?? 'Alguien'} {c.body} · {cuandoRelativo(c.created_at)}
      </p>
    )
  }
  return (
    <div className="rounded-md border border-border bg-background p-2.5">
      <p className="mb-1 flex items-baseline gap-2 text-xs">
        <span className="font-medium">{c.autor?.display_name ?? 'Alguien'}</span>
        <span className="text-muted-foreground">{cuandoRelativo(c.created_at)}</span>
        <button
          onClick={onResponder}
          className="ml-auto text-muted-foreground hover:text-foreground"
        >
          Responder
        </button>
      </p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.body}</p>
    </div>
  )
}

// ── Formulario de una acción ─────────────────────────────────────────────────

function FormularioAccion({
  accion, s, personas, departamentos, onCerrar, onHecho,
}: {
  accion: AccionSolicitud
  s: Solicitud
  personas: Persona[]
  departamentos: Departamento[]
  onCerrar: () => void
  onHecho: () => void
}) {
  const regla = TRANSICIONES[accion]
  const [nota, setNota] = useState('')
  const [spaceId, setSpaceId] = useState(s.space_id ?? '')
  const [assigneeId, setAssigneeId] = useState(s.assignee_id ?? '')
  const [dueDate, setDueDate] = useState(s.due_date ?? '')
  const [title, setTitle] = useState(s.title)
  const [body, setBody] = useState(s.body ?? '')
  const [priority, setPriority] = useState<Prioridad>((s.priority as Prioridad) ?? 'normal')
  const [neededBy, setNeededBy] = useState(s.needed_by ?? '')
  const [guardando, setGuardando] = useState(false)

  async function mandar() {
    if (regla.exigeNota && !nota.trim()) {
      toast.error('Hace falta explicar el motivo')
      return
    }
    if (accion === 'canalizar' && !spaceId && !assigneeId) {
      toast.error('Elige un departamento o una persona')
      return
    }
    setGuardando(true)
    try {
      const cuerpo: Record<string, unknown> = { accion }
      if (nota.trim()) cuerpo.nota = nota.trim()
      if (accion === 'canalizar') {
        cuerpo.spaceId = spaceId || null
        cuerpo.assigneeId = assigneeId || null
        cuerpo.dueDate = dueDate || null
      }
      if (accion === 'editar') {
        cuerpo.title = title.trim()
        cuerpo.body = body.trim() || null
        cuerpo.priority = priority
        cuerpo.needed_by = neededBy || null
      }
      const res = await fetch(`/api/tickets/${s.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo')
      toast.success('Listo')
      onHecho()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se pudo')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Overlay onCerrar={onCerrar}>
      <div className="w-full max-w-lg space-y-4 rounded-lg border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">{ETIQUETA_ACCION[accion]}</h3>
          <button onClick={onCerrar} className="rounded p-1 hover:bg-accent">
            <X size={16} />
          </button>
        </div>

        {accion === 'editar' && (
          <>
            <Campo label="Título">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </Campo>
            <Campo label="Detalle">
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </Campo>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Urgencia">
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as Prioridad)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  {PRIORIDADES.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </select>
              </Campo>
              <Campo label="La necesito para">
                <input
                  type="date"
                  value={neededBy}
                  onChange={(e) => setNeededBy(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                />
              </Campo>
            </div>
          </>
        )}

        {accion === 'canalizar' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Campo label="Departamento">
                <select
                  value={spaceId}
                  onChange={(e) => setSpaceId(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Sin departamento</option>
                  {departamentos.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </Campo>
              <Campo label="Responsable">
                <select
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                >
                  <option value="">Sin responsable</option>
                  {personas.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </Campo>
            </div>
            <Campo label="Fecha comprometida">
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </Campo>
          </>
        )}

        <Campo label={regla.exigeNota ? 'Motivo (obligatorio)' : 'Nota (opcional)'}>
          <textarea
            value={nota}
            onChange={(e) => setNota(e.target.value)}
            rows={3}
            maxLength={5000}
            placeholder={
              accion === 'rechazar'
                ? 'Por qué no procede. Un rechazo sin motivo se lee igual que un silencio.'
                : accion === 'resolver'
                  ? 'Qué se hizo, para que quien pidió sepa qué recibió.'
                  : 'Contexto para quien lo lea después.'
            }
            className="w-full resize-y rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Campo>

        <div className="flex justify-end gap-2">
          <button onClick={onCerrar} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent">
            Cancelar
          </button>
          <button
            onClick={mandar}
            disabled={guardando}
            className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {guardando && <Loader2 size={14} className="animate-spin" />}
            Confirmar
          </button>
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
      // Cerrar al tocar fuera, pero solo si el clic empezó y terminó en la capa:
      // si no, arrastrar el cursor desde un campo de texto hasta el borde cierra
      // el panel y se pierde lo que se estaba escribiendo.
      onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar() }}
    >
      {children}
    </div>
  )
}

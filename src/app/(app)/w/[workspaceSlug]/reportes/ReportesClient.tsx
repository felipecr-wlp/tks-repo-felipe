'use client'

/**
 * Vista del reporte diario: tu dia arriba, el del equipo abajo.
 *
 * Decisiones que no son cosmeticas:
 * - La captura principal NO vive aqui, vive en el chat con KERN. Esta pantalla
 *   asume que la mayoria del contenido llego contado, no tecleado en un
 *   formulario. El campo de alta manual existe para corregir y completar, por
 *   eso es una sola linea y no un formulario de cuatro campos.
 * - Se muestra quien NO reporto. Un tablero que solo lista lo que existe
 *   esconde justo el dato que hace falta para dar seguimiento.
 * - Editar es solo del dueño del reporte. Los reportes ajenos se leen, punto:
 *   un dia firmado por quien no lo vivio no vale nada.
 * - El dia va en la URL (?d=), asi un dia concreto se comparte con un enlace y
 *   el boton de atras del navegador funciona como uno espera.
 */
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { confirmDialog } from '@/components/ConfirmDialog'
import {
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  Check,
  CircleDot,
  AlertTriangle,
  ArrowRight,
  MessageSquare,
  Sparkles,
  Lock,
  Unlock,
} from 'lucide-react'
import {
  CATEGORY_LABEL,
  REPORT_CATEGORIES,
  formatReportDate,
  formatReportTime,
  shiftDate,
  type ReportCategory,
} from '@/lib/daily-reports'

export interface ReporteEntrada {
  id: string
  content: string
  category: string
  minutes: number | null
  source: string
  created_at: string
}

export interface ReporteDia {
  id: string
  profile_id: string
  display_name: string
  avatar_url: string | null
  summary: string | null
  status: 'draft' | 'submitted'
  submitted_at: string | null
  entries: ReporteEntrada[]
}

export interface MiembroSinReporte {
  id: string
  display_name: string
  avatar_url: string | null
}

interface Props {
  workspaceId: string
  workspaceSlug: string
  date: string
  today: string
  currentUserId: string
  reportes: ReporteDia[]
  sinReporte: MiembroSinReporte[]
}

const CATEGORY_STYLE: Record<ReportCategory, { icon: typeof CircleDot; className: string }> = {
  avance: { icon: Check, className: 'text-emerald-600 dark:text-emerald-400' },
  bloqueo: { icon: AlertTriangle, className: 'text-red-600 dark:text-red-400' },
  siguiente: { icon: ArrowRight, className: 'text-blue-600 dark:text-blue-400' },
  nota: { icon: CircleDot, className: 'text-muted-foreground' },
}

/** La categoria llega de la base como texto suelto: lo desconocido cae en nota. */
function asCategory(value: string): ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(value) ? (value as ReportCategory) : 'nota'
}

function categoryStyle(category: string) {
  return CATEGORY_STYLE[asCategory(category)]
}

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(p => p.charAt(0).toUpperCase())
    .join('')
}

function Avatar({ name, url, size = 28 }: { name: string; url: string | null; size?: number }) {
  if (url) {
    return (
      // Avatares de Supabase Storage: next/image no aporta aqui (ya vienen
      // recortados y pesan poco) y obligaria a configurar el dominio remoto.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt={name}
        width={size}
        height={size}
        className="rounded-full object-cover flex-shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <span
      className="flex-shrink-0 flex items-center justify-center rounded-full bg-muted text-muted-foreground font-medium"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  )
}

export function ReportesClient({
  workspaceId,
  workspaceSlug,
  date,
  today,
  currentUserId,
  reportes,
  sinReporte,
}: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  const mio = reportes.find(r => r.profile_id === currentUserId) ?? null
  const otros = reportes.filter(r => r.profile_id !== currentUserId)

  const [texto, setTexto] = useState('')
  const [categoria, setCategoria] = useState<ReportCategory>('avance')
  const [guardando, setGuardando] = useState(false)
  const [resumen, setResumen] = useState(mio?.summary ?? '')
  const [editandoResumen, setEditandoResumen] = useState(false)

  const esHoy = date === today
  const enFuturo = date > today

  const irA = (d: string) => {
    startTransition(() => router.push(`/w/${workspaceSlug}/reportes?d=${d}`))
  }

  const refrescar = () => startTransition(() => router.refresh())

  async function agregar() {
    const limpio = texto.trim()
    if (limpio.length < 3) {
      toast.error('Escribe al menos unas palabras.')
      return
    }
    setGuardando(true)
    try {
      const res = await fetch('/api/daily-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, content: limpio, category: categoria, date }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo registrar')
      setTexto('')
      refrescar()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setGuardando(false)
    }
  }

  async function borrar(entryId: string) {
    const ok = await confirmDialog({
      title: 'Borrar actividad',
      message: 'Se quita del reporte del día. No se puede deshacer.',
      confirmLabel: 'Borrar',
      destructive: true,
    })
    if (!ok) return
    try {
      const res = await fetch(`/api/daily-reports/entries/${entryId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? 'No se pudo borrar')
      }
      refrescar()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    }
  }

  async function guardarReporte(patch: { summary?: string | null; status?: 'draft' | 'submitted' }) {
    try {
      const res = await fetch('/api/daily-reports', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId, date, ...patch }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar')
      if (patch.status === 'submitted') toast.success('Reporte del día cerrado.')
      if (patch.status === 'draft') toast.success('Reporte reabierto.')
      setEditandoResumen(false)
      refrescar()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    }
  }

  const totalActividades = reportes.reduce((n, r) => n + r.entries.length, 0)

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
      {/* ── Encabezado y navegacion por dia ─────────────────────────────── */}
      <header className="space-y-3">
        <div className="flex items-start gap-2.5">
          <ClipboardList className="w-5 h-5 mt-0.5 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground leading-tight">Reporte diario</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Cuéntale tu día a KERN en el chat y aquí queda registrado. También puedes escribirlo a mano.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => irA(shiftDate(date, -1))}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Día anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="px-3 py-1.5 rounded-lg border border-border bg-card">
            <span className="text-sm font-medium text-foreground capitalize">{formatReportDate(date)}</span>
            {esHoy && <span className="ml-2 text-[11px] font-medium text-primary">hoy</span>}
          </div>
          <button
            onClick={() => irA(shiftDate(date, 1))}
            disabled={enFuturo || esHoy}
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-40 disabled:pointer-events-none"
            aria-label="Día siguiente"
          >
            <ChevronRight size={16} />
          </button>
          {!esHoy && (
            <button
              onClick={() => irA(today)}
              className="px-2.5 py-1.5 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              Ir a hoy
            </button>
          )}
          <span className="text-xs text-muted-foreground ml-auto">
            {reportes.length} {reportes.length === 1 ? 'persona' : 'personas'} · {totalActividades}{' '}
            {totalActividades === 1 ? 'actividad' : 'actividades'}
          </span>
        </div>
      </header>

      {/* ── Mi dia ──────────────────────────────────────────────────────── */}
      <section className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold text-foreground">Mi día</h2>
          {mio && (
            <div className="flex items-center gap-2">
              {mio.status === 'submitted' ? (
                <>
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                    <Check size={12} /> Entregado
                  </span>
                  <button
                    onClick={() => guardarReporte({ status: 'draft' })}
                    className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Unlock size={12} /> Reabrir
                  </button>
                </>
              ) : (
                <button
                  onClick={() => guardarReporte({ status: 'submitted', summary: resumen.trim() || null })}
                  disabled={mio.entries.length === 0}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
                  title={mio.entries.length === 0 ? 'Registra algo antes de cerrar el día' : undefined}
                >
                  <Lock size={12} /> Cerrar el día
                </button>
              )}
            </div>
          )}
        </div>

        <div className="p-4 space-y-4">
          {/* Alta manual: una linea, no un formulario. */}
          <div className="flex flex-col sm:flex-row gap-2">
            <select
              value={categoria}
              onChange={e => setCategoria(e.target.value as ReportCategory)}
              className="sm:w-36 px-2.5 py-2 text-sm border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label="Tipo de actividad"
            >
              {REPORT_CATEGORIES.map(c => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </select>
            <input
              value={texto}
              onChange={e => setTexto(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  void agregar()
                }
              }}
              placeholder="¿Qué hiciste? Ej. cerré la campaña de Google Ads de julio"
              maxLength={1000}
              className="flex-1 px-3 py-2 text-sm border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              onClick={() => void agregar()}
              disabled={guardando || texto.trim().length < 3}
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:pointer-events-none"
            >
              <Plus size={15} /> Registrar
            </button>
          </div>

          {/* Linea de tiempo del dia */}
          {mio && mio.entries.length > 0 ? (
            <ul className="space-y-1.5">
              {mio.entries.map(e => {
                const { icon: Icon, className } = categoryStyle(e.category)
                return (
                  <li
                    key={e.id}
                    className="group flex items-start gap-2.5 px-2.5 py-2 rounded-lg hover:bg-accent/50 transition-colors"
                  >
                    <Icon size={15} className={cn('mt-0.5 flex-shrink-0', className)} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground break-words">{e.content}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5 flex items-center gap-1.5">
                        <span>{formatReportTime(e.created_at)}</span>
                        <span>·</span>
                        <span>{CATEGORY_LABEL[asCategory(e.category)]}</span>
                        {e.minutes != null && (
                          <>
                            <span>·</span>
                            <span>{e.minutes} min</span>
                          </>
                        )}
                        {e.source === 'kern' && (
                          <>
                            <span>·</span>
                            <span className="inline-flex items-center gap-0.5">
                              <Sparkles size={10} /> KERN
                            </span>
                          </>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => void borrar(e.id)}
                      className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                      aria-label="Borrar actividad"
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="flex items-start gap-2.5 px-3 py-4 rounded-lg border border-dashed border-border text-sm text-muted-foreground">
              <MessageSquare size={16} className="mt-0.5 flex-shrink-0" />
              <p>
                Todavía no hay nada de este día. Escríbelo arriba, o simplemente cuéntaselo a KERN en el chat
                (&quot;ya terminé el reporte de SEO&quot;) y él lo registra por ti.
              </p>
            </div>
          )}

          {/* Resumen del dia */}
          {mio && (mio.summary || editandoResumen) && (
            <div className="pt-1">
              <p className="text-xs font-medium text-muted-foreground mb-1.5">Resumen del día</p>
              {editandoResumen ? (
                <div className="space-y-2">
                  <textarea
                    value={resumen}
                    onChange={e => setResumen(e.target.value)}
                    rows={4}
                    maxLength={4000}
                    className="w-full px-3 py-2 text-sm border border-input rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-y"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void guardarReporte({ summary: resumen.trim() || null })}
                      className="px-2.5 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      Guardar
                    </button>
                    <button
                      onClick={() => {
                        setResumen(mio.summary ?? '')
                        setEditandoResumen(false)
                      }}
                      className="px-2.5 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setEditandoResumen(true)}
                  className="w-full text-left text-sm text-foreground whitespace-pre-wrap rounded-lg px-3 py-2 bg-muted/50 hover:bg-muted transition-colors"
                >
                  {mio.summary}
                </button>
              )}
            </div>
          )}
          {mio && !mio.summary && !editandoResumen && mio.entries.length > 0 && (
            <button
              onClick={() => setEditandoResumen(true)}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Agregar un resumen del día
            </button>
          )}
        </div>
      </section>

      {/* ── El equipo ───────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">El equipo</h2>

        {otros.length === 0 && (
          <p className="text-sm text-muted-foreground px-1">Nadie más ha registrado actividades de este día.</p>
        )}

        {otros.map(r => (
          <article key={r.id} className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-border">
              <Avatar name={r.display_name} url={r.avatar_url} />
              <span className="text-sm font-medium text-foreground truncate">{r.display_name}</span>
              <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                {r.status === 'submitted' && (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">
                    <Check size={11} /> Entregado
                  </span>
                )}
                <span className="text-[11px] text-muted-foreground">
                  {r.entries.length} {r.entries.length === 1 ? 'actividad' : 'actividades'}
                </span>
              </span>
            </div>
            <div className="px-4 py-3 space-y-2">
              {r.summary && <p className="text-sm text-foreground whitespace-pre-wrap">{r.summary}</p>}
              <ul className="space-y-1">
                {r.entries.map(e => {
                  const { icon: Icon, className } = categoryStyle(e.category)
                  return (
                    <li key={e.id} className="flex items-start gap-2 text-sm">
                      <Icon size={14} className={cn('mt-1 flex-shrink-0', className)} />
                      <span className="text-foreground break-words">{e.content}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground flex-shrink-0">
                        {formatReportTime(e.created_at)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </article>
        ))}

        {/* La ausencia tambien es informacion. */}
        {sinReporte.length > 0 && (
          <div className="rounded-xl border border-dashed border-border px-4 py-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              Sin reporte este día ({sinReporte.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {sinReporte.map(m => (
                <span
                  key={m.id}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border border-border text-xs text-muted-foreground"
                >
                  <Avatar name={m.display_name} url={m.avatar_url} size={18} />
                  {m.display_name}
                </span>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

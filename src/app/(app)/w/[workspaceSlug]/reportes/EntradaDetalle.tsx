'use client'

/**
 * La actividad del reporte, abierta.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 * Una linea de reporte ("Optimice dos paginas de Redwood City") es un titulo,
 * no un registro. Lo que hace falta despues casi siempre es lo mismo y siempre
 * es lo que no cabia: cuales paginas, DONDE quedo, que sigue pendiente. Sin un
 * lugar para eso, el enlace de lo entregado se queda en el chat de alguien o no
 * existe, y la pregunta "¿donde quedo esto?" se repite cada semana.
 *
 * El detalle es texto enriquecido del MISMO editor que las notas y el resumen
 * del dia. No es comodidad: es lo que hace que los enlaces salgan gratis, ya
 * saneados y con rel=noopener, sin inventar un campo de URL propio que habria
 * que validar por separado y que solo aceptaria una.
 *
 * ── El panel es de lectura para todos y de escritura para uno ───────────────
 * El mando abre la actividad de su equipo y ve el detalle y la evidencia, pero
 * no el editor ni el boton de subir. Es la misma regla del modulo: leer el dia
 * ajeno si, escribirlo no. La barrera de verdad la pone el servidor
 * (loadEntryOwnership); esto solo evita ofrecer un boton que iba a devolver 403.
 *
 * ── Lo unico que este panel no puede permitirse ─────────────────────────────
 * Perder lo escrito. La persona pega la URL de lo que entrego, hace clic fuera
 * y se va. Por eso cerrar con cambios sin guardar PREGUNTA, y por eso el borrador
 * de la IA cae en el editor sin guardarse: nada se escribe en el reporte de
 * alguien sin que esa persona lo vea primero y le de a guardar.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import {
  X,
  Sparkles,
  Loader2,
  ImagePlus,
  CheckSquare,
  Check,
  AlertTriangle,
  ArrowRight,
  CircleDot,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  CATEGORY_LABEL,
  REPORT_CATEGORIES,
  formatReportTime,
  type ReportCategory,
} from '@/lib/daily-reports'
import { prepareReportImage } from '@/lib/daily-report-images'
import { sanitizeRichText } from '@/lib/sanitize'
import { ReportImageStrip, type ReporteImagen } from './ReportImageStrip'

/**
 * Mismo motivo que en el resumen del dia: TipTap pesa ~140KB y la mayoria de
 * las visitas al reporte no abren ninguna actividad. Se carga al abrir el panel.
 */
const RichTextEditor = dynamic(
  () => import('@/components/editor/RichTextEditor').then(m => m.RichTextEditor),
  { ssr: false, loading: () => <div className="h-32 animate-pulse rounded-lg bg-muted/50" /> }
)

export interface EntradaAbierta {
  id: string
  content: string
  category: string
  minutes: number | null
  source: string
  created_at: string
  resolved_at: string | null
  details: string | null
  task: { id: string; title: string } | null
  images: ReporteImagen[]
}

interface Props {
  entrada: EntradaAbierta
  /** Solo el dueño del reporte escribe. El mando entra en solo lectura. */
  puedeEditar: boolean
  onCerrar: () => void
  /** Releer la pantalla: lo guardado vive en el servidor, no en este estado. */
  onCambio: () => void
  onAbrirTarea?: (taskId: string) => void
}

const ICONO: Record<ReportCategory, typeof CircleDot> = {
  avance: Check,
  bloqueo: AlertTriangle,
  siguiente: ArrowRight,
  nota: CircleDot,
}

const COLOR: Record<ReportCategory, string> = {
  avance: 'text-emerald-600 dark:text-emerald-400',
  bloqueo: 'text-red-600 dark:text-red-400',
  siguiente: 'text-blue-600 dark:text-blue-400',
  nota: 'text-muted-foreground',
}

function asCategory(value: string): ReportCategory {
  return (REPORT_CATEGORIES as readonly string[]).includes(value) ? (value as ReportCategory) : 'nota'
}

/**
 * ¿El editor tiene algo? Vacio devuelve `<p></p>`, no cadena vacia. Guardar eso
 * marcaria la actividad como "tiene detalle" cuando no tiene nada.
 */
function conTexto(html: string): string | null {
  const limpio = html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
  return limpio.length > 0 ? html : null
}

export function EntradaDetalle({ entrada, puedeEditar, onCerrar, onCambio, onAbrirTarea }: Props) {
  const categoria = asCategory(entrada.category)
  const Icono = ICONO[categoria]

  const [detalle, setDetalle] = useState(entrada.details ?? '')
  // Numero de veces que un texto ENTRO al editor desde fuera (hoy, el borrador
  // de la IA). Va como `key` del editor para forzar un montaje nuevo, y sube
  // SOLO ahi: si subiera al teclear, el editor se remontaria en cada pulsacion
  // y se perderia el cursor. Ver el comentario largo junto al editor.
  const [revision, setRevision] = useState(0)
  const [guardando, setGuardando] = useState(false)
  const [desglosando, setDesglosando] = useState(false)
  const [subiendo, setSubiendo] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Se compara contra lo que llego, no contra "el editor cambio". El editor
  // emite cambios al montarse (normaliza el HTML) y sin esto el panel diria que
  // hay cambios sin guardar en cuanto se abre, cada vez, hasta que la
  // advertencia deje de significar algo.
  const original = entrada.details ?? ''
  const hayCambios = puedeEditar && (conTexto(detalle) ?? '') !== original

  const cerrar = useCallback(() => {
    if (hayCambios && !confirm('Tienes cambios sin guardar en el detalle. ¿Cerrar de todas formas?')) {
      return
    }
    onCerrar()
  }, [hayCambios, onCerrar])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cerrar])

  async function guardar() {
    setGuardando(true)
    try {
      const res = await fetch(`/api/daily-reports/entries/${entrada.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ details: conTexto(detalle) }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string; details?: string | null }
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar el detalle')
      // Lo que devuelve el servidor es lo que quedo guardado, ya saneado. Si el
      // saneador quito algo, se ve aqui y no al recargar mañana.
      setDetalle(data.details ?? '')
      toast.success('Detalle guardado')
      onCambio()
      onCerrar()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setGuardando(false)
    }
  }

  /**
   * Pide a la IA un borrador y lo pone en el editor. No lo guarda: el reporte
   * lleva el nombre de una persona y nada entra ahi sin que lo lea antes.
   */
  async function desglosar() {
    setDesglosando(true)
    try {
      const res = await fetch(`/api/daily-reports/entries/${entrada.id}/desglosar`, { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { html?: string; error?: string }
      if (!res.ok || !data.html) throw new Error(data.error ?? 'No se pudo desglosar')
      // Se AGREGA debajo de lo que ya escribio. Reemplazar seria borrarle texto
      // propio con texto de un modelo, que es exactamente lo que no debe pasar.
      setDetalle(prev => (conTexto(prev) ? `${prev}${data.html}` : data.html!))
      // Sin esto el borrador entra al estado y NO se ve. El editor solo acepta
      // texto de fuera cuando esta vacio, asi que el segundo desglose (y
      // cualquiera sobre un detalle ya escrito) se quedaba invisible: la
      // pantalla mostraba una cosa y se guardaba otra, que es justo el fallo
      // silencioso que este panel existe para evitar. Medido en produccion:
      // cinco puntos en pantalla, nueve en la base.
      setRevision(r => r + 1)
      toast.success('Borrador listo. Revísalo y complétalo antes de guardar.')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error desconocido')
    } finally {
      setDesglosando(false)
    }
  }

  async function subirImagen(file: File) {
    setSubiendo(true)
    try {
      // Se comprime en el navegador, igual que al registrar la actividad: es lo
      // que mantiene la subida bajo el techo de ~4.5MB de Vercel.
      const prep = await prepareReportImage(file)
      const form = new FormData()
      form.append('full', new File([prep.full], `evidencia.${prep.ext}`, { type: prep.full.type }))
      form.append('thumb', new File([prep.thumb], `evidencia_t.${prep.ext}`, { type: prep.thumb.type }))
      form.append('width', String(prep.width))
      form.append('height', String(prep.height))
      const res = await fetch(`/api/daily-reports/entries/${entrada.id}/images`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(err.error ?? 'No se pudo guardar la imagen')
      }
      toast.success('Evidencia agregada')
      onCambio()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se pudo preparar la imagen')
    } finally {
      setSubiendo(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Detalle de la actividad"
      onClick={cerrar}
      className="fixed inset-0 z-50 flex justify-end bg-black/30 backdrop-blur-[2px]"
    >
      <div
        onClick={e => e.stopPropagation()}
        className="flex h-full w-full max-w-xl flex-col overflow-hidden border-l border-border bg-card shadow-overlay"
      >
        {/* Encabezado: la linea tal cual se registro. No se edita aqui a
            proposito. Cambiar el titulo de una actividad ya contada es reescribir
            el reporte; para eso esta borrar y volver a registrar. */}
        <header className="flex items-start gap-3 border-b border-border px-5 py-4">
          <Icono
            size={17}
            className={cn('mt-0.5 flex-shrink-0', entrada.resolved_at ? 'text-muted-foreground' : COLOR[categoria])}
          />
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                'text-sm font-medium break-words',
                entrada.resolved_at ? 'text-muted-foreground line-through' : 'text-foreground'
              )}
            >
              {entrada.content}
            </p>
            <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>{formatReportTime(entrada.created_at)}</span>
              <span>·</span>
              <span>{CATEGORY_LABEL[categoria]}</span>
              {entrada.resolved_at && (
                <>
                  <span>·</span>
                  <span className="text-emerald-600 dark:text-emerald-500">resuelto</span>
                </>
              )}
              {entrada.minutes != null && (
                <>
                  <span>·</span>
                  <span>{entrada.minutes} min</span>
                </>
              )}
              {entrada.source === 'kern' && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-0.5">
                    <Sparkles size={10} /> asistente
                  </span>
                </>
              )}
            </p>
          </div>
          <button
            onClick={cerrar}
            aria-label="Cerrar"
            className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {entrada.task && (
            <button
              type="button"
              onClick={() => onAbrirTarea?.(entrada.task!.id)}
              className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <CheckSquare size={12} className="flex-shrink-0" />
              <span className="truncate">{entrada.task.title}</span>
            </button>
          )}

          {/* ── Detalle ───────────────────────────────────────────────────── */}
          <section>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">Detalle</h3>
              {puedeEditar && (
                <button
                  onClick={() => void desglosar()}
                  disabled={desglosando}
                  title="La IA propone los pasos y deja los huecos marcados. No inventa datos ni guarda nada."
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {desglosando ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                  {desglosando ? 'Desglosando...' : 'Desglosar con IA'}
                </button>
              )}
            </div>

            {puedeEditar ? (
              <>
                {/* `autosaveMs` NO guarda en el servidor: `onSave` aqui solo
                    copia el HTML al estado del panel. Es imprescindible igual.
                    Sin el, el editor solo avisa al PERDER EL FOCO, y eso rompe
                    las dos cosas que este panel promete: el boton Guardar
                    mandaria el texto anterior al que se acaba de teclear (el
                    click lee el estado de su propio render, que el blur todavia
                    no actualizo), y salir con Escape justo despues de escribir
                    un enlace se llevaria el texto SIN preguntar, porque
                    `hayCambios` seguiria en falso. Perder ahi lo escrito es
                    justo el fallo silencioso que el panel existe para evitar. */}
                {/* `key` remonta el editor cuando llega un borrador de la IA.
                    RichTextEditor solo copia `value` de fuera si esta VACIO, y
                    esa guarda es correcta: protege lo que se esta tecleando de
                    ser pisado. Pero convierte el desglose sobre un detalle ya
                    escrito en un no-op mudo. Se remonta aqui, y no se afloja la
                    guarda del editor, porque ese editor lo comparten notas,
                    tareas y documentos: cambiarle las reglas arreglaria esta
                    pantalla y arriesgaria las otras tres.
                    Remontar no pierde nada: al hacer clic en el boton el editor
                    pierde el foco, y en el blur vuelca su HTML al estado, asi
                    que lo tecleado ya viaja dentro de `detalle`. */}
                <RichTextEditor
                  key={revision}
                  value={detalle}
                  onSave={html => setDetalle(html)}
                  autosaveMs={400}
                  blocks="basic"
                  density="compact"
                  placeholder="Qué se hizo exactamente, el enlace de lo entregado y qué queda pendiente."
                  className="rounded-lg border border-input bg-background"
                />
                {/* Mientras la IA escribe, esta linea dice cuanto tarda. El
                    modelo se toma cerca de medio minuto y el boton solo cambia
                    a "Desglosando...", que a los quince segundos se lee como
                    una pantalla colgada: al probarlo se dio por roto algo que
                    estaba funcionando. Una espera anunciada se espera; una
                    espera muda se abandona. Se reusa el hueco del consejo de
                    enlaces para no mover el editor de sitio al aparecer. */}
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {desglosando
                    ? 'La IA está redactando el borrador. Suele tardar hasta medio minuto.'
                    : 'Para pegar un enlace, selecciona el texto y usa el botón de enlace de la barra.'}
                </p>
              </>
            ) : detalle ? (
              // Se sanea AQUI aunque las tres fuentes de `detalle` ya vengan
              // saneadas (el servidor al leer el dia, la respuesta del PATCH y
              // la del desglose). "Ya viene limpio de arriba" es un argumento
              // que envejece mal: basta una cuarta fuente para volverlo falso, y
              // el sink es el unico sitio donde la garantia no depende de
              // acordarse. Cuesta una pasada de DOMPurify sobre un par de
              // renglones.
              <div
                className="prose prose-sm dark:prose-invert max-w-none rounded-lg bg-muted/40 px-3 py-2 text-sm"
                dangerouslySetInnerHTML={{ __html: sanitizeRichText(detalle) }}
              />
            ) : (
              <p className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted-foreground">
                Esta actividad no tiene detalle.
              </p>
            )}
          </section>

          {/* ── Evidencia ─────────────────────────────────────────────────── */}
          <section>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">Evidencia</h3>
              {puedeEditar && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) void subirImagen(f)
                    }}
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={subiendo}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
                  >
                    {subiendo ? <Loader2 size={11} className="animate-spin" /> : <ImagePlus size={11} />}
                    {subiendo ? 'Subiendo...' : 'Agregar imagen'}
                  </button>
                </>
              )}
            </div>
            {entrada.images.length > 0 ? (
              <ReportImageStrip images={entrada.images} canDelete={puedeEditar} onDeleted={onCambio} />
            ) : (
              <p className="text-xs text-muted-foreground">
                {puedeEditar
                  ? 'Una captura vale más que la descripción de la captura.'
                  : 'Sin evidencia adjunta.'}
              </p>
            )}
          </section>
        </div>

        {puedeEditar && (
          <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
            <span className="text-[11px] text-muted-foreground">
              {hayCambios ? 'Cambios sin guardar' : 'Todo guardado'}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={cerrar}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                Cerrar
              </button>
              {/* Guardar NO se deshabilita por "no hay cambios". El estado del
                  panel va unos cientos de ms detras del teclado (el editor
                  avisa con debounce), asi que un boton atado a `hayCambios`
                  estaria muerto justo en el instante en que alguien termina de
                  escribir y hace clic: se veria como que la app ignoro el clic.
                  Guardar lo mismo dos veces no cuesta nada; parecer roto, si.
                  `hayCambios` se queda donde no puede fallar: la etiqueta y el
                  aviso al cerrar. */}
              <button
                onClick={() => void guardar()}
                disabled={guardando}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {guardando && <Loader2 size={12} className="animate-spin" />}
                Guardar detalle
              </button>
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}

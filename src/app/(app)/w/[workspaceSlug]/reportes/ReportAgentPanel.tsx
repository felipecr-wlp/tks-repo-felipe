'use client'

/**
 * BITACORA: el panel de conversacion del reporte diario.
 *
 * Lo que resuelve: nadie escribe su reporte porque escribirlo es una tarea
 * aparte del trabajo. Aqui se cuenta el dia como se le cuenta a un compañero y
 * el agente lo convierte en actividades clasificadas. La persona no elige
 * categoria ni formato.
 *
 * ── El recorrido de una imagen ──────────────────────────────────────────────
 * Es el punto delicado, porque una imagen viaja DOS veces y por razones
 * distintas:
 *
 *   1. Al modelo, en linea y comprimida, para que lea lo que muestra y redacte
 *      la actividad y su pie de foto. Esa copia no se guarda.
 *   2. Al bucket, despues, colgada de la actividad que el agente acaba de
 *      crear. Por eso `registrar_actividad` devuelve `entry_id`: sin ese dato
 *      no habria a que adjuntarla.
 *
 * La compresion ocurre ANTES de las dos, en el navegador. El original de 4MB
 * nunca sale de la maquina de quien lo subio.
 */
import { useChat, type Message } from 'ai/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Markdown } from '@/components/kern/Markdown'
import { prepareReportImage, type PreparedImage } from '@/lib/daily-report-images'
import { mensajeDeErrorIA } from '@/lib/ai/mensaje-de-error'

const SUGERENCIAS = [
  'Terminé la revisión de campañas de julio',
  'Estoy bloqueado esperando accesos',
  'Léeme lo que llevo hoy',
]

/**
 * El atajo que invierte el flujo.
 *
 * La pregunta "¿que hiciste hoy?" pone a la persona a redactar desde cero algo
 * que la app ya sabe: las tareas que cerro estan en el tablero. Este boton le
 * pide al agente que lea ese tablero y PROPONGA el reporte, para que la persona
 * solo confirme o corrija. Confirmar cuesta un clic; redactar cuesta el dia.
 */
const PROPONER = 'Revisa lo que ya cerré hoy y propónme el reporte.'

// El nombre tecnico de la herramienta jamas se muestra crudo. Si se agrega una
// nueva en report-agent.ts hay que darla de alta aqui.
const TOOL_LABELS: Record<string, { running: string; done: string }> = {
  registrar_actividad: { running: 'Registrando actividad', done: 'Actividad registrada' },
  mi_trabajo_de_hoy: { running: 'Revisando tu tablero', done: 'Tablero revisado' },
  leer_mi_dia: { running: 'Leyendo tu día', done: 'Día leído' },
  borrar_actividad: { running: 'Quitando actividad', done: 'Actividad quitada' },
  cerrar_dia: { running: 'Cerrando el reporte', done: 'Reporte cerrado' },
  resumen_del_equipo: { running: 'Revisando al equipo', done: 'Equipo revisado' },
}

interface Props {
  workspaceId: string
  date: string
  /** Se llama cuando el agente escribio algo, para refrescar la linea de tiempo. */
  onChanged?: () => void
}

/** Blob -> data URL. El endpoint espera `data:image/webp;base64,...`. */
function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'))
    reader.readAsDataURL(blob)
  })
}

export function ReportAgentPanel({ workspaceId, date, onChanged }: Props) {
  const router = useRouter()
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Imagen elegida y todavia no enviada.
  const [pendiente, setPendiente] = useState<PreparedImage | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [preparando, setPreparando] = useState(false)
  const [avisoImagen, setAvisoImagen] = useState<string | null>(null)

  // La que ya viajo con el mensaje y espera a que el agente devuelva un
  // entry_id al que colgarse. Va en ref y no en estado: cambia a mitad del
  // ciclo de streaming y no debe provocar re-render.
  const enVuelo = useRef<PreparedImage | null>(null)
  /** Cuantos turnos lleva la imagen esperando una actividad a la que colgarse. */
  const turnosEnVuelo = useRef(0)
  const [subiendo, setSubiendo] = useState(false)

  const subirAdjunto = useCallback(
    async (entryId: string, img: PreparedImage) => {
      const form = new FormData()
      const ext = img.ext
      form.append('full', new File([img.full], `evidencia.${ext}`, { type: img.full.type }))
      form.append('thumb', new File([img.thumb], `evidencia_t.${ext}`, { type: img.thumb.type }))
      form.append('width', String(img.width))
      form.append('height', String(img.height))

      setSubiendo(true)
      try {
        const res = await fetch(`/api/daily-reports/entries/${entryId}/images`, {
          method: 'POST',
          body: form,
        })
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string }
          setAvisoImagen(json.error ?? 'La actividad quedó registrada, pero la imagen no se pudo guardar.')
        }
      } finally {
        setSubiendo(false)
      }
    },
    []
  )

  const alTerminar = useCallback(
    async (message: Message) => {
      // Se busca la ULTIMA actividad creada en el turno: si el agente registro
      // varias cosas de un mismo mensaje, la imagen pertenece a la que redacto
      // a partir de ella, que es la que lleva pie de foto.
      const invs = message.toolInvocations ?? []
      let entryId: string | null = null
      for (const inv of invs) {
        if (inv.toolName !== 'registrar_actividad' || inv.state !== 'result') continue
        const r = inv.result as { entry_id?: string; caption?: string | null } | undefined
        if (!r?.entry_id) continue
        if (!entryId || r.caption) entryId = r.entry_id
      }

      const img = enVuelo.current
      if (img && entryId) {
        enVuelo.current = null
        turnosEnVuelo.current = 0
        await subirAdjunto(entryId, img)
      } else if (img) {
        // El turno NO creo ninguna actividad. Pasa cuando el agente pregunta algo
        // antes de registrar: si es vago pide concretar, y desde el detector de
        // duplicados tambien pregunta si es lo mismo que ya esta anotado. Soltar
        // la imagen aqui la perderia justo cuando la persona esta a UNA respuesta
        // de que se registre.
        //
        // Se conserva dos turnos como mucho: lo suficiente para responder una
        // pregunta, y no tanto como para que una captura vieja acabe colgada de
        // una actividad que no tiene nada que ver.
        turnosEnVuelo.current += 1
        if (turnosEnVuelo.current > 2) {
          enVuelo.current = null
          turnosEnVuelo.current = 0
          setAvisoImagen('La imagen no se llegó a adjuntar a ninguna actividad. Vuelve a subirla si la necesitas.')
        }
      }

      // Cualquier herramienta que escriba deja la pantalla desactualizada.
      if (invs.some(i => i.toolName !== 'leer_mi_dia' && i.toolName !== 'resumen_del_equipo')) {
        onChanged?.()
        router.refresh()
      }
    },
    [onChanged, router, subirAdjunto]
  )

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    append,
    isLoading,
    error,
    setMessages,
    setInput,
  } = useChat({
    api: '/api/daily-reports/agent',
    body: { workspace_id: workspaceId, date },
    onFinish: alTerminar,
  })

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, isLoading])

  // La vista previa es un object URL: hay que revocarlo o se queda en memoria.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  const elegirArchivo = useCallback(async (file: File) => {
    setAvisoImagen(null)
    setPreparando(true)
    try {
      const prep = await prepareReportImage(file)
      setPendiente(prep)
      setPreview(prev => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(prep.thumb)
      })
    } catch (e) {
      setAvisoImagen(e instanceof Error ? e.message : 'No se pudo preparar la imagen')
    } finally {
      setPreparando(false)
    }
  }, [])

  // Pegar una captura es el gesto natural aqui: se toma con la tecla de
  // pantalla y se pega, sin pasar por guardar el archivo.
  const alPegar = useCallback(
    (e: React.ClipboardEvent) => {
      const file = Array.from(e.clipboardData.files).find(f => f.type.startsWith('image/'))
      if (file) {
        e.preventDefault()
        void elegirArchivo(file)
      }
    },
    [elegirArchivo]
  )

  const quitarPendiente = useCallback(() => {
    setPendiente(null)
    setPreview(prev => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
  }, [])

  const enviar = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      if (!input.trim() && !pendiente) return

      let imagePayload: { data: string; mime: 'image/webp' | 'image/jpeg' } | null = null
      if (pendiente) {
        // Al modelo va la version COMPLETA: la miniatura de 320px no deja leer
        // los numeros de un panel, que es justo lo que se le pide mirar.
        const data = await toDataUrl(pendiente.full)
        imagePayload = {
          data,
          mime: pendiente.ext === 'webp' ? 'image/webp' : 'image/jpeg',
        }
        enVuelo.current = pendiente
        turnosEnVuelo.current = 0
        quitarPendiente()
      }

      handleSubmit(e, {
        body: { workspace_id: workspaceId, date, image: imagePayload },
      })
    },
    [date, handleSubmit, input, pendiente, quitarPendiente, workspaceId]
  )

  /**
   * Convencion unica de la app: Enter envia, Shift+Enter salto de linea.
   * Se comprueba `isComposing` porque los teclados de dictado y los IME
   * disparan un Enter para CONFIRMAR la palabra; sin esto, hablarle al reporte
   * enviaria el mensaje a media frase.
   */
  const alTeclear = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
      e.preventDefault()
      void enviar(e)
    },
    [enviar]
  )

  return (
    <section className="flex h-[520px] flex-col overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-center justify-between border-b border-border bg-[#0F0F10] px-4 py-2.5 text-white">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FED500] text-[#0F0F10]">
            <BookIcon className="h-4.5 w-4.5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-wide">BITÁCORA</p>
            <p className="text-[11px] text-white/50">Cuéntale tu día y él lo registra</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            title="Limpiar conversación"
            className="rounded-md p-1.5 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-2 text-center">
            <p className="text-sm font-medium text-foreground">¿Qué hiciste hoy?</p>
            <p className="mt-1 mb-4 text-xs text-muted-foreground">
              Escríbelo como se lo contarías a alguien. También puedes pegar una captura como evidencia.
            </p>

            {/* Camino corto primero: que el agente lea el tablero y proponga. */}
            <button
              onClick={() => void append({ role: 'user', content: PROPONER })}
              disabled={isLoading}
              className="mb-3 w-full rounded-lg bg-[#0F0F10] px-3 py-2.5 text-xs font-medium text-[#FED500] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Armar mi día con lo que ya cerré
            </button>

            <div className="flex w-full flex-col gap-1.5">
              {SUGERENCIAS.map(s => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="rounded-lg border border-border px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(m => {
            const invs = m.toolInvocations ?? []
            return (
              <div
                key={m.id}
                className={cn('flex flex-col gap-1.5', m.role === 'user' ? 'items-end' : 'items-start')}
              >
                {invs.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {invs.map((inv, i) => {
                      const label = TOOL_LABELS[inv.toolName]
                      const done = inv.state === 'result'
                      return (
                        <span
                          key={inv.toolCallId ?? i}
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px]',
                            done
                              ? 'border-border bg-muted/60 text-muted-foreground'
                              : 'border-[#FED500]/40 bg-[#FED500]/10 text-[#8a7400]'
                          )}
                        >
                          <span className={cn(!done && 'animate-pulse')}>
                            {done ? label?.done ?? 'Listo' : label?.running ?? 'Trabajando...'}
                          </span>
                        </span>
                      )
                    })}
                  </div>
                )}
                {m.content &&
                  (m.role === 'user' ? (
                    <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                      {m.content}
                    </div>
                  ) : (
                    <div className="max-w-[92%] break-words rounded-2xl rounded-bl-sm border border-border/70 bg-muted/70 px-3.5 py-2.5 text-[13px] text-foreground">
                      <Markdown text={m.content} />
                    </div>
                  ))}
              </div>
            )
          })
        )}

        {(isLoading || subiendo) && (
          <p className="text-xs text-muted-foreground">
            {subiendo ? 'Guardando la imagen...' : 'Pensando...'}
          </p>
        )}

        {error && (
          <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {mensajeDeErrorIA(error)}
          </div>
        )}
        {avisoImagen && (
          <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{avisoImagen}</div>
        )}
      </div>

      <form onSubmit={enviar} className="border-t border-border bg-card p-2.5">
        {(preview || preparando) && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-2 py-1.5">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Adjunto" width={36} height={36} className="h-9 w-9 rounded object-cover" />
            ) : (
              <span className="h-9 w-9 animate-pulse rounded bg-muted" />
            )}
            <span className="flex-1 truncate text-xs text-muted-foreground">
              {preparando ? 'Comprimiendo imagen...' : 'Imagen lista para enviar'}
            </span>
            {preview && (
              <button
                type="button"
                onClick={quitarPendiente}
                className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Quitar imagen"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) void elegirArchivo(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Adjuntar imagen"
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ClipIcon className="h-4 w-4" />
          </button>
          {/*
            Es textarea, no input: un reporte de actividades casi nunca es una
            linea sola, y con un input de una linea no existe forma de escribir
            un salto. Crece hasta 8rem y de ahi hace scroll, para no comerse el
            historial de la conversacion.
          */}
          <textarea
            value={input}
            onChange={handleInputChange}
            onPaste={alPegar}
            onKeyDown={alTeclear}
            rows={1}
            placeholder="Cuéntale qué hiciste...  (Enter para enviar, Shift+Enter salto de línea)"
            className="flex-1 resize-none max-h-32 rounded-xl bg-muted/60 px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
          <button
            type="submit"
            disabled={(!input.trim() && !pendiente) || isLoading || preparando}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#0F0F10] text-[#FED500] transition-opacity hover:opacity-90 disabled:opacity-40"
            aria-label="Enviar"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </div>
      </form>
    </section>
  )
}

function BookIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </svg>
  )
}

function ClipIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.4 11.05 12.25 20.2a5.5 5.5 0 0 1-7.78-7.78l9.19-9.19a3.67 3.67 0 0 1 5.19 5.19l-9.2 9.19a1.83 1.83 0 0 1-2.59-2.59l8.49-8.48" />
    </svg>
  )
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  )
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" />
    </svg>
  )
}

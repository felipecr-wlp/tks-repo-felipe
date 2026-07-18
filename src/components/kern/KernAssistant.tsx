'use client'

/**
 * KERN, asistente de IA general de WLO.
 * Lanzador flotante (abajo a la derecha) + panel de chat en streaming.
 * Conectado a Google Gemini Flash vía /api/kern (Vercel AI SDK).
 *
 * Disponible en toda la app: se monta una sola vez en el layout protegido.
 */
import { useChat } from 'ai/react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

const SUGGESTIONS = [
  'Resume mis prioridades de hoy',
  'Divide este objetivo en subtareas',
  'Redacta una nota de seguimiento',
]

export function KernAssistant() {
  const [open, setOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const {
    messages,
    input,
    handleInputChange,
    handleSubmit,
    isLoading,
    error,
    setMessages,
    setInput,
  } = useChat({ api: '/api/kern' })

  // Auto-scroll al último mensaje
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isLoading])

  // Foco al abrir + cerrar con Escape
  useEffect(() => {
    if (open) inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      {/* ── Lanzador flotante ─────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(v => !v)}
        aria-label={open ? 'Cerrar KERN' : 'Abrir KERN'}
        className={cn(
          'fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center',
          'rounded-full shadow-raised transition-all duration-200',
          'bg-[#0F0F10] text-[#FED500] hover:scale-105 active:scale-95',
          'ring-1 ring-[#FED500]/30',
          open && 'opacity-0 pointer-events-none scale-90'
        )}
      >
        <SparkIcon className="h-6 w-6" />
      </button>

      {/* ── Panel de chat ─────────────────────────────────────────────── */}
      <div
        className={cn(
          'fixed bottom-5 right-5 z-50 flex flex-col overflow-hidden',
          'w-[min(380px,calc(100vw-2.5rem))] h-[min(580px,calc(100vh-2.5rem))]',
          'rounded-2xl border border-border bg-card shadow-overlay',
          'origin-bottom-right transition-all duration-200',
          open ? 'opacity-100 scale-100' : 'opacity-0 scale-95 pointer-events-none'
        )}
      >
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 bg-[#0F0F10] text-white">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#FED500] text-[#0F0F10]">
              <SparkIcon className="h-5 w-5" />
            </span>
            <div className="leading-tight">
              <p className="text-sm font-semibold tracking-wide">KERN</p>
              <p className="text-[11px] text-white/50">Asistente IA</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && (
              <button
                onClick={() => setMessages([])}
                title="Limpiar conversación"
                className="rounded-md p-1.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            )}
            <button
              onClick={() => setOpen(false)}
              title="Cerrar"
              className="rounded-md p-1.5 text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
        </header>

        {/* Mensajes */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center px-2">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#FED500]/15 text-[#caa800] mb-3">
                <SparkIcon className="h-6 w-6" />
              </span>
              <p className="text-sm font-medium text-foreground">¿En qué te ayudo?</p>
              <p className="text-xs text-muted-foreground mt-1 mb-4">
                Planifica, redacta, resume y organiza tu trabajo.
              </p>
              <div className="flex flex-col gap-1.5 w-full">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => {
                      setInput(s)
                      inputRef.current?.focus()
                    }}
                    className="text-left text-xs px-3 py-2 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map(m => (
              <div
                key={m.id}
                className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
              >
                <div
                  className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap break-words',
                    m.role === 'user'
                      ? 'bg-primary text-primary-foreground rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm'
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))
          )}

          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-2xl rounded-bl-sm px-3.5 py-2.5">
                <TypingDots />
              </div>
            </div>
          )}

          {error && (
            <div className="text-xs text-destructive bg-destructive/10 rounded-lg px-3 py-2">
              KERN no pudo responder. Verifica que la API key de Gemini esté configurada.
            </div>
          )}
        </div>

        {/* Input */}
        <form
          onSubmit={handleSubmit}
          className="border-t border-border p-2.5 flex items-end gap-2 bg-card"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={handleInputChange}
            placeholder="Escribe a KERN..."
            className="flex-1 resize-none bg-muted/60 rounded-xl px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#0F0F10] text-[#FED500] transition-opacity disabled:opacity-40 hover:opacity-90"
            aria-label="Enviar"
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </form>
      </div>
    </>
  )
}

// ── Iconos inline (sin dependencias extra) ──────────────────────────────────
function SparkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
      <path d="M19 15l.7 2 .3.8 2 .7-2 .7-.3.8-.7 2-.7-2-.3-.8-2-.7 2-.7.3-.8.7-2z" opacity="0.6" />
    </svg>
  )
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
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

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
  )
}

function TypingDots() {
  return (
    <span className="flex gap-1">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.3s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce [animation-delay:-0.15s]" />
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce" />
    </span>
  )
}

'use client'

/**
 * TeamChat, chat de equipo en tiempo real.
 *
 * Se suscribe a los INSERT de la tabla messages filtrados por team_id y hace
 * append en vivo (no router.refresh, para no recargar todo el hilo). Resuelve
 * el autor con el mapa de miembros que pasa el server. Envía via POST
 * /api/messages con update optimista + dedupe por id (el propio INSERT del
 * emisor también llega por realtime).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { MessageSquare, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

interface Member {
  id: string
  display_name: string
  avatar_url: string | null
}

interface Message {
  id: string
  author_id: string
  body: string
  created_at: string
}

interface TeamChatProps {
  teamId: string
  currentUserId: string
  members: Member[]
  initialMessages: Message[]
}

export function TeamChat({ teamId, currentUserId, members, initialMessages }: TeamChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  // Historial: asumimos que hay más si la carga inicial vino "llena".
  const [hasMore, setHasMore] = useState(initialMessages.length >= 20)
  const [loadingMore, setLoadingMore] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prependingRef = useRef(false)

  const memberById = useMemo(() => {
    const m = new Map<string, Member>()
    for (const mem of members) m.set(mem.id, mem)
    return m
  }, [members])

  // Append sin duplicar (dedupe por id).
  function upsertMessage(msg: Message) {
    setMessages(prev => {
      if (prev.some(m => m.id === msg.id)) return prev
      return [...prev, msg]
    })
  }

  // ── Realtime: nuevos mensajes del equipo ──────────────────────────────────
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase
      .channel(`chat-${teamId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `team_id=eq.${teamId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const row = payload.new as Message
          upsertMessage(row)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [teamId])

  // Auto-scroll al fondo cuando llega o se envía un mensaje. Al prepender
  // historia antigua NO saltamos al fondo (se preserva la posición de lectura).
  useEffect(() => {
    if (prependingRef.current) {
      prependingRef.current = false
      return
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  // Cargar mensajes anteriores (paginación por cursor sobre el más antiguo).
  async function loadOlder() {
    if (loadingMore || !hasMore) return
    const oldest = messages[0]?.created_at
    setLoadingMore(true)
    const el = scrollRef.current
    const prevHeight = el?.scrollHeight ?? 0
    try {
      const params = new URLSearchParams({ team_id: teamId, limit: '30' })
      if (oldest) params.set('before', oldest)
      const res = await fetch(`/api/messages?${params.toString()}`)
      if (!res.ok) throw new Error('load failed')
      const data = (await res.json()) as { messages: Message[]; hasMore: boolean }
      prependingRef.current = true
      setMessages(prev => {
        const seen = new Set(prev.map(m => m.id))
        const older = data.messages.filter(m => !seen.has(m.id))
        return [...older, ...prev]
      })
      setHasMore(data.hasMore)
      // Preservar posición: mantener el mismo mensaje bajo la vista.
      requestAnimationFrame(() => {
        const cur = scrollRef.current
        if (cur) cur.scrollTop = cur.scrollHeight - prevHeight
      })
    } catch {
      toast.error('No se pudo cargar el historial')
    } finally {
      setLoadingMore(false)
    }
  }

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setDraft('')
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ team_id: teamId, body }),
      })
      if (!res.ok) throw new Error('send failed')
      const msg = (await res.json()) as Message
      upsertMessage(msg)
    } catch {
      toast.error('No se pudo enviar el mensaje')
      setDraft(body)
    } finally {
      setSending(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Hilo */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {hasMore && messages.length > 0 && (
          <div className="flex justify-center pb-1">
            <button
              onClick={loadOlder}
              disabled={loadingMore}
              className="text-xs font-medium text-muted-foreground hover:text-foreground px-3 py-1.5 rounded-full border border-border hover:bg-muted transition-colors disabled:opacity-50"
            >
              {loadingMore ? 'Cargando…' : 'Cargar mensajes anteriores'}
            </button>
          </div>
        )}
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <MessageSquare className="h-8 w-8 mb-2 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Aún no hay mensajes. Escribe el primero para arrancar la conversación del equipo.
            </p>
          </div>
        )}

        {messages.map((msg, i) => {
          const author = memberById.get(msg.author_id)
          const mine = msg.author_id === currentUserId
          const prev = messages[i - 1]
          const grouped = prev && prev.author_id === msg.author_id
          return (
            <div key={msg.id} className={cn('flex gap-2.5', mine && 'flex-row-reverse')}>
              <div className="flex-shrink-0 w-7">
                {!grouped && (
                  author?.avatar_url ? (
                    <Image
                      src={author.avatar_url}
                      alt={author.display_name}
                      width={28}
                      height={28}
                      className="rounded-full"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-xs font-medium text-accent-foreground">
                      {(author?.display_name ?? '?').charAt(0).toUpperCase()}
                    </div>
                  )
                )}
              </div>
              <div className={cn('max-w-[75%] min-w-0', mine && 'items-end flex flex-col')}>
                {!grouped && (
                  <div className={cn('flex items-baseline gap-2 mb-0.5', mine && 'flex-row-reverse')}>
                    <span className="text-xs font-medium text-foreground truncate">
                      {mine ? 'Tú' : (author?.display_name ?? 'Miembro')}
                    </span>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                )}
                <div
                  className={cn(
                    'px-3 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words',
                    mine
                      ? 'bg-primary text-primary-foreground rounded-tr-sm'
                      : 'bg-muted text-foreground rounded-tl-sm'
                  )}
                >
                  {msg.body}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Escribe un mensaje…  (Enter para enviar, Shift+Enter salto de línea)"
            className="flex-1 resize-none max-h-32 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={send}
            disabled={sending || draft.trim().length === 0}
            aria-label="Enviar mensaje"
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Enviar
          </button>
        </div>
      </div>
    </div>
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  if (sameDay) {
    return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }) +
    ' ' + d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' })
}

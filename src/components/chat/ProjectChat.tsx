'use client'

/**
 * ProjectChat, chat de proyecto en tiempo real (espeja TeamChat).
 *
 * Se suscribe a los INSERT de project_messages filtrados por project_id y hace
 * append en vivo (no router.refresh). Resuelve el autor con el mapa de miembros
 * que pasa el server. Envia via POST /api/projects/[projectId]/messages con
 * update optimista + dedupe por id (el propio INSERT del emisor tambien llega
 * por realtime).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { MessagesSquare } from 'lucide-react'
import { toast } from 'sonner'
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

interface ProjectChatProps {
  projectId: string
  currentUserId: string
  members: Member[]
  initialMessages: Message[]
}

export function ProjectChat({ projectId, currentUserId, members, initialMessages }: ProjectChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

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

  // Realtime: nuevos mensajes del proyecto
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase
      .channel(`project-chat-${projectId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'project_messages', filter: `project_id=eq.${projectId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const row = payload.new as Message
          upsertMessage(row)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [projectId])

  // Auto-scroll al fondo cuando llega o se envia un mensaje.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function send() {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setDraft('')
    try {
      const res = await fetch(`/api/projects/${projectId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
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
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center">
            <MessagesSquare className="w-8 h-8 text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              Aun no hay mensajes. Escribe el primero para arrancar la conversacion del proyecto.
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
                      {mine ? 'Tu' : (author?.display_name ?? 'Miembro')}
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
            placeholder="Escribe un mensaje...  (Enter para enviar, Shift+Enter salto de linea)"
            className="flex-1 resize-none max-h-32 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={send}
            disabled={sending || draft.trim().length === 0}
            className="flex-shrink-0 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
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

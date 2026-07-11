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
import { MessagesSquare, SmilePlus } from 'lucide-react'
import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

// Set de emojis del picker. Debe coincidir con el whitelist del endpoint
// /messages/[messageId]/reactions para que el toggle sea consistente.
const EMOJIS = ['👍', '❤️', '😄', '🎉', '🙌', '👀', '🔥', '✅'] as const

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

interface Reaction {
  id: string
  message_id: string
  profile_id: string
  emoji: string
}

interface ProjectChatProps {
  projectId: string
  currentUserId: string
  members: Member[]
  initialMessages: Message[]
  initialReactions?: Reaction[]
}

export function ProjectChat({ projectId, currentUserId, members, initialMessages, initialReactions = [] }: ProjectChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [reactions, setReactions] = useState<Reaction[]>(initialReactions)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Reacciones agrupadas por mensaje, y dentro por emoji (para pintar pills con
  // conteo y saber si la persona actual ya reacciono).
  const reactionsByMessage = useMemo(() => {
    const map = new Map<string, { emoji: string; count: number; mine: boolean; who: string[] }[]>()
    const nested = new Map<string, Map<string, { count: number; mine: boolean; who: string[] }>>()
    for (const r of reactions) {
      if (!nested.has(r.message_id)) nested.set(r.message_id, new Map())
      const byEmoji = nested.get(r.message_id)!
      const cur = byEmoji.get(r.emoji) ?? { count: 0, mine: false, who: [] }
      cur.count += 1
      if (r.profile_id === currentUserId) cur.mine = true
      cur.who.push(r.profile_id)
      byEmoji.set(r.emoji, cur)
    }
    for (const [msgId, byEmoji] of nested) {
      map.set(msgId, [...byEmoji.entries()].map(([emoji, v]) => ({ emoji, ...v })))
    }
    return map
  }, [reactions, currentUserId])

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

  // Dedupe de reacciones por id (INSERT propio + realtime pueden coincidir).
  function upsertReaction(r: Reaction) {
    setReactions(prev => (prev.some(x => x.id === r.id) ? prev : [...prev, r]))
  }
  function removeReaction(id: string) {
    setReactions(prev => prev.filter(x => x.id !== id))
  }

  // Realtime: nuevos mensajes + reacciones del proyecto (mismo canal).
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
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'message_reactions', filter: `project_id=eq.${projectId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => { upsertReaction(payload.new as Reaction) }
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'DELETE', schema: 'public', table: 'message_reactions', filter: `project_id=eq.${projectId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => { if (payload.old?.id) removeReaction(payload.old.id as string) }
      )
      .subscribe()

    return () => { supabase.removeChannel(ch) }
  }, [projectId])

  // Alterna una reaccion con update optimista; el realtime confirma o corrige.
  async function toggleReaction(messageId: string, emoji: string) {
    setPickerFor(null)
    const existing = reactions.find(
      r => r.message_id === messageId && r.profile_id === currentUserId && r.emoji === emoji
    )
    // Optimista: quitar o agregar con un id temporal (se reemplaza por el real).
    const tempId = `temp-${messageId}-${emoji}`
    if (existing) {
      removeReaction(existing.id)
    } else {
      upsertReaction({ id: tempId, message_id: messageId, profile_id: currentUserId, emoji })
    }
    try {
      const res = await fetch(`/api/projects/${projectId}/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      })
      if (!res.ok) throw new Error('reaction failed')
      // Quitar el placeholder; el registro real llega por realtime.
      removeReaction(tempId)
    } catch {
      // Revertir el update optimista.
      removeReaction(tempId)
      if (existing) upsertReaction(existing)
      toast.error('No se pudo actualizar la reacción')
    }
  }

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
                <div className={cn('group/msg relative flex items-center gap-1', mine && 'flex-row-reverse')}>
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

                  {/* Disparador del picker (aparece al hover del mensaje). */}
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={() => setPickerFor(pickerFor === msg.id ? null : msg.id)}
                      title="Reaccionar"
                      className={cn(
                        'p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-all',
                        pickerFor === msg.id ? 'opacity-100' : 'opacity-0 group-hover/msg:opacity-100'
                      )}
                    >
                      <SmilePlus className="w-3.5 h-3.5" />
                    </button>
                    {pickerFor === msg.id && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setPickerFor(null)} />
                        <div className={cn(
                          'absolute z-50 bottom-full mb-1 flex items-center gap-0.5 p-1 rounded-full border border-border bg-popover shadow-lg',
                          mine ? 'right-0' : 'left-0'
                        )}>
                          {EMOJIS.map(e => (
                            <button
                              key={e}
                              onClick={() => toggleReaction(msg.id, e)}
                              className="w-7 h-7 flex items-center justify-center rounded-full text-base hover:bg-muted transition-colors"
                            >
                              {e}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Pills de reacciones agregadas. */}
                {(() => {
                  const pills = reactionsByMessage.get(msg.id)
                  if (!pills || pills.length === 0) return null
                  return (
                    <div className={cn('flex flex-wrap gap-1 mt-1', mine && 'justify-end')}>
                      {pills.map(p => (
                        <button
                          key={p.emoji}
                          onClick={() => toggleReaction(msg.id, p.emoji)}
                          title={p.who.map(id => memberById.get(id)?.display_name ?? 'Miembro').join(', ')}
                          className={cn(
                            'flex items-center gap-1 px-1.5 h-6 rounded-full border text-xs transition-colors',
                            p.mine
                              ? 'border-primary/40 bg-primary/10 text-foreground'
                              : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted'
                          )}
                        >
                          <span className="text-sm leading-none">{p.emoji}</span>
                          <span className="tabular-nums">{p.count}</span>
                        </button>
                      ))}
                    </div>
                  )
                })()}
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

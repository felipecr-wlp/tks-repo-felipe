'use client'

/**
 * WorkspaceChat, chat GENERAL del workspace en tiempo real (entre equipos).
 *
 * Espeja a TeamChat pero scopeado por workspace_id en vez de team_id: aqui
 * conversa cualquier miembro del workspace sin importar su equipo. v2 con
 * realtime, presencia, "escribiendo…", paginacion por cursor, reacciones emoji
 * y adjuntos de archivo (bucket privado chat-files, prefijo workspace/<id>/).
 * No incluye adjuntos de tarea (son por equipo) ni recordatorios.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { MessagesSquare, Loader2, X, SmilePlus, Paperclip, Download, FileText, Megaphone } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

// Set de emojis del picker. Debe coincidir con el whitelist del endpoint
// /api/workspace/[workspaceId]/messages/[messageId]/reactions.
const EMOJIS = ['👍', '❤️', '😄', '🎉', '🙌', '👀', '🔥', '✅'] as const

const MAX_ATTACHMENTS = 5
const NETWORK_ERR = '__network__'

// POST con reintento SEGURO: solo reintenta ante fallo de red (la peticion nunca
// llego al servidor), nunca ante un HTTP no-ok (evita duplicar el mensaje).
async function postMessage(payload: unknown, attempt = 0): Promise<Response> {
  try {
    return await fetch('/api/workspace-messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch {
    if (attempt < 2) {
      await new Promise(r => setTimeout(r, 300 * Math.pow(3, attempt)))
      return postMessage(payload, attempt + 1)
    }
    throw new Error(NETWORK_ERR)
  }
}

interface Member {
  id: string
  display_name: string
  avatar_url: string | null
}

interface Reaction {
  id: string
  message_id: string
  profile_id: string
  emoji: string
}

interface FileAttachment {
  type: 'file'
  path: string
  name: string
  mime: string
  size: number
}
type Attachment = FileAttachment

// Archivo subido y listo para adjuntar (aun no enviado). Guardamos el File para
// previsualizar localmente sin esperar la signed URL del servidor.
interface PendingFile {
  path: string
  name: string
  mime: string
  size: number
  localUrl?: string
}

interface Message {
  id: string
  author_id: string
  body: string
  created_at: string
  attachments?: Attachment[] | null
}

interface WorkspaceChatProps {
  workspaceId: string
  currentUserId: string
  members: Member[]
  initialMessages: Message[]
  initialReactions?: Reaction[]
  /**
   * ¿El visor puede publicar? El General es canal de COMUNICADOS: lo lee todo
   * el workspace, lo escriben solo los mandos. Esto apaga la UI; el candado
   * real vive en /api/workspace-messages y en la policy wsm_insert.
   */
  canPost?: boolean
}

export function WorkspaceChat({
  workspaceId,
  currentUserId,
  members,
  initialMessages,
  initialReactions = [],
  canPost = true,
}: WorkspaceChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [reactions, setReactions] = useState<Reaction[]>(initialReactions)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [hasMore, setHasMore] = useState(initialMessages.length >= 20)
  const [loadingMore, setLoadingMore] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prependingRef = useRef(false)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null)
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const [typingIds, setTypingIds] = useState<Record<string, number>>({})
  const lastTypingSentRef = useRef(0)

  // Adjuntos de archivo: cola pendiente + estado de subida + input oculto.
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Cache de signed URLs de archivos (path -> url). Se resuelve al render.
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({})

  const pendingCount = pendingFiles.length

  const memberById = useMemo(() => {
    const m = new Map<string, Member>()
    for (const mem of members) m.set(mem.id, mem)
    return m
  }, [members])

  // Reacciones agrupadas por mensaje, y dentro por emoji.
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

  function upsertReaction(r: Reaction) {
    setReactions(prev => (prev.some(x => x.id === r.id) ? prev : [...prev, r]))
  }
  function removeReaction(id: string) {
    setReactions(prev => prev.filter(x => x.id !== id))
  }

  // Escape cierra el picker de reacciones.
  useEffect(() => {
    if (!pickerFor) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerFor(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickerFor])

  // Alterna una reaccion con update optimista; el realtime confirma o corrige.
  async function toggleReaction(messageId: string, emoji: string) {
    setPickerFor(null)
    const existing = reactions.find(
      r => r.message_id === messageId && r.profile_id === currentUserId && r.emoji === emoji
    )
    const tempId = `temp-${messageId}-${emoji}`
    if (existing) {
      removeReaction(existing.id)
    } else {
      upsertReaction({ id: tempId, message_id: messageId, profile_id: currentUserId, emoji })
    }
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      })
      if (!res.ok) throw new Error('reaction failed')
      removeReaction(tempId)
    } catch {
      removeReaction(tempId)
      if (existing) upsertReaction(existing)
      toast.error('No se pudo actualizar la reacción')
    }
  }

  // Resuelve en lote las signed URLs de los archivos que aparecen en el hilo y
  // aun no estan en cache (historial + realtime).
  useEffect(() => {
    const needed = new Set<string>()
    for (const msg of messages) {
      for (const att of msg.attachments ?? []) {
        if (att.type === 'file' && !(att.path in fileUrls)) needed.add(att.path)
      }
    }
    if (needed.size === 0) return
    let cancelled = false
    const paths = Array.from(needed).slice(0, 40)
    const params = new URLSearchParams({ paths: paths.join(',') })
    fetch(`/api/workspace/${workspaceId}/chat-files/sign?${params.toString()}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('sign'))))
      .then((data: { files: { path: string; url: string }[] }) => {
        if (cancelled) return
        setFileUrls(prev => {
          const next = { ...prev }
          for (const f of data.files) next[f.path] = f.url
          return next
        })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [messages, workspaceId, fileUrls])

  function removePendingFile(path: string) {
    setPendingFiles(prev => {
      const gone = prev.find(f => f.path === path)
      if (gone?.localUrl) URL.revokeObjectURL(gone.localUrl)
      return prev.filter(f => f.path !== path)
    })
  }

  // Sube los archivos elegidos (uno por uno) y los agrega a la cola pendiente.
  async function onFilesChosen(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    setUploading(true)
    try {
      for (const file of files) {
        if (pendingCount + 1 > MAX_ATTACHMENTS) {
          toast.error(`Máximo ${MAX_ATTACHMENTS} adjuntos por mensaje`)
          break
        }
        if (file.size > 25 * 1024 * 1024) {
          toast.error(`"${file.name}" supera el límite de 25MB`)
          continue
        }
        const form = new FormData()
        form.append('file', file)
        try {
          const res = await fetch(`/api/workspace/${workspaceId}/chat-files`, { method: 'POST', body: form })
          if (!res.ok) throw new Error('upload failed')
          const data = (await res.json()) as { path: string; name: string; mime: string; size: number }
          const localUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
          setPendingFiles(prev => [...prev, { ...data, localUrl }])
        } catch {
          toast.error(`No se pudo subir "${file.name}"`)
        }
      }
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  function upsertMessage(msg: Message) {
    setMessages(prev => (prev.some(m => m.id === msg.id) ? prev : [...prev, msg]))
  }

  // ── Realtime: mensajes + reacciones + presencia + tecleo ──────────────────
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase
      .channel(`ws-chat-${workspaceId}`, {
        config: { presence: { key: currentUserId }, broadcast: { self: false } },
      })
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'workspace_messages', filter: `workspace_id=eq.${workspaceId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const row = payload.new as Message
          upsertMessage(row)
          setTypingIds(prev => {
            if (!(row.author_id in prev)) return prev
            const next = { ...prev }
            delete next[row.author_id]
            return next
          })
        }
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'workspace_message_reactions', filter: `workspace_id=eq.${workspaceId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => { upsertReaction(payload.new as Reaction) }
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'DELETE', schema: 'public', table: 'workspace_message_reactions', filter: `workspace_id=eq.${workspaceId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => { if (payload.old?.id) removeReaction(payload.old.id as string) }
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'broadcast' as any,
        { event: 'typing' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const id = payload?.payload?.id as string | undefined
          if (!id || id === currentUserId) return
          setTypingIds(prev => ({ ...prev, [id]: Date.now() }))
        }
      )
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState() as Record<string, unknown[]>
        setOnlineIds(new Set(Object.keys(state)))
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .subscribe((status: string) => {
        if (status === 'SUBSCRIBED') ch.track({ id: currentUserId, at: Date.now() })
      })

    channelRef.current = ch
    return () => {
      channelRef.current = null
      supabase.removeChannel(ch)
    }
  }, [workspaceId, currentUserId])

  // Poda de senales de tecleo (>4s) + re-render que refresca el indicador.
  useEffect(() => {
    const t = setInterval(() => {
      setTypingIds(prev => {
        const now = Date.now()
        const next: Record<string, number> = {}
        let changed = false
        for (const [id, ts] of Object.entries(prev)) {
          if (now - ts < 4000) next[id] = ts
          else changed = true
        }
        return changed ? next : prev
      })
    }, 1500)
    return () => clearInterval(t)
  }, [])

  function broadcastTyping() {
    const now = Date.now()
    if (now - lastTypingSentRef.current < 1500) return
    lastTypingSentRef.current = now
    channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { id: currentUserId } })
  }

  const typingNames = useMemo(
    () =>
      Object.keys(typingIds)
        .filter(id => id !== currentUserId)
        .map(id => memberById.get(id)?.display_name ?? 'Alguien'),
    [typingIds, currentUserId, memberById]
  )

  // Auto-scroll al fondo al llegar/enviar. Al prepender historia NO saltamos.
  useEffect(() => {
    if (prependingRef.current) {
      prependingRef.current = false
      return
    }
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  async function loadOlder() {
    if (loadingMore || !hasMore) return
    const oldest = messages[0]?.created_at
    setLoadingMore(true)
    const el = scrollRef.current
    const prevHeight = el?.scrollHeight ?? 0
    try {
      const params = new URLSearchParams({ workspace_id: workspaceId, limit: '30' })
      if (oldest) params.set('before', oldest)
      const res = await fetch(`/api/workspace-messages?${params.toString()}`)
      if (!res.ok) throw new Error('load failed')
      const data = (await res.json()) as { messages: Message[]; hasMore: boolean; reactions?: Reaction[] }
      prependingRef.current = true
      setMessages(prev => {
        const seen = new Set(prev.map(m => m.id))
        const older = data.messages.filter(m => !seen.has(m.id))
        return [...older, ...prev]
      })
      if (data.reactions?.length) {
        setReactions(prev => {
          const seen = new Set(prev.map(r => r.id))
          const extra = data.reactions!.filter(r => !seen.has(r.id))
          return extra.length ? [...prev, ...extra] : prev
        })
      }
      setHasMore(data.hasMore)
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
    const files = pendingFiles
    if ((!body && files.length === 0) || sending || uploading) return
    setSending(true)
    setDraft('')
    setPendingFiles([])
    // Preview local de imagenes para verlas al instante sin esperar la signed URL.
    if (files.length > 0) {
      setFileUrls(prev => {
        const next = { ...prev }
        for (const f of files) if (f.localUrl && !(f.path in next)) next[f.path] = f.localUrl
        return next
      })
    }
    const attachments: Attachment[] = files.map(f => ({
      type: 'file' as const, path: f.path, name: f.name, mime: f.mime, size: f.size,
    }))
    const payload = {
      workspace_id: workspaceId,
      body,
      ...(attachments.length > 0 ? { attachments } : {}),
    }
    try {
      const res = await postMessage(payload)
      if (!res.ok) {
        let serverMsg = ''
        try {
          const data = (await res.json()) as { error?: unknown }
          if (typeof data?.error === 'string') serverMsg = data.error
        } catch { /* respuesta sin JSON */ }
        throw new Error(serverMsg || 'No se pudo enviar el mensaje')
      }
      const msg = (await res.json()) as Message
      upsertMessage(msg)
    } catch (err) {
      const msg =
        err instanceof Error && err.message === NETWORK_ERR
          ? 'Sin conexión: no se pudo enviar tras reintentar. Revisa tu red.'
          : err instanceof Error && err.message
            ? err.message
            : 'No se pudo enviar el mensaje'
      toast.error(msg)
      setDraft(body)
      setPendingFiles(files)
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
            <MessagesSquare className="h-8 w-8 mb-2 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground max-w-xs">
              Este es el canal General del workspace. Aquí conversan todos los equipos: escribe el primer mensaje para arrancar.
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
                  <div className="relative w-7 h-7">
                    {author?.avatar_url ? (
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
                    )}
                    {!mine && onlineIds.has(msg.author_id) && (
                      <span
                        title="En línea"
                        className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-background"
                      />
                    )}
                  </div>
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
                <div className={cn('group/msg relative flex items-end gap-1', mine && 'flex-row-reverse')}>
                  <div className={cn('flex flex-col gap-1 min-w-0', mine && 'items-end')}>
                    {msg.body && (
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
                    )}
                    {(msg.attachments ?? []).map((att, ai) =>
                      att.type === 'file' ? (
                        <FileAttachmentView
                          key={`${att.path}-${ai}`}
                          att={att}
                          url={fileUrls[att.path]}
                          mine={mine}
                        />
                      ) : null
                    )}
                  </div>

                  {/* Accion de reaccion (aparece al hover). */}
                  <div className="relative flex-shrink-0">
                    <button
                      onClick={() => setPickerFor(pickerFor === msg.id ? null : msg.id)}
                      title="Reaccionar"
                      aria-label="Reaccionar al mensaje"
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
                          'absolute z-50 bottom-full mb-1 flex items-center gap-0.5 p-1 rounded-full border border-border bg-popover shadow-raised',
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

      {/* Composer. Solo para quien puede publicar comunicados; el resto ve el
          aviso de abajo y conversa en el chat de su departamento. */}
      {!canPost ? (
        <div className="border-t border-border px-4 py-3">
          <div className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
            <Megaphone className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Canal de comunicados.</span>{' '}
              Aquí publican los responsables. Para conversar, usa el chat de tu departamento.
            </p>
          </div>
        </div>
      ) : (
      <div className="border-t border-border px-4 py-3">
        {typingNames.length > 0 && (
          <div className="mb-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="flex gap-0.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" />
            </span>
            <span className="truncate">
              {typingNames.length === 1
                ? `${typingNames[0]} está escribiendo…`
                : typingNames.length === 2
                  ? `${typingNames[0]} y ${typingNames[1]} están escribiendo…`
                  : 'Varios están escribiendo…'}
            </span>
          </div>
        )}
        {/* Adjuntos pendientes de enviar */}
        {pendingFiles.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingFiles.map(f => (
              <span
                key={f.path}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 pl-2.5 pr-1.5 py-1 text-xs text-foreground"
              >
                {f.mime.startsWith('image/') && f.localUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.localUrl} alt="" className="h-4 w-4 rounded object-cover" />
                ) : (
                  <FileText className="h-3 w-3 text-primary" />
                )}
                <span className="max-w-[10rem] truncate">{f.name}</span>
                <span className="text-[10px] text-muted-foreground">{formatBytes(f.size)}</span>
                <button
                  onClick={() => removePendingFile(f.path)}
                  aria-label={`Quitar ${f.name}`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          {/* Adjuntar archivo */}
          <div className="flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={e => onFilesChosen(e.target.files)}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading || pendingCount >= MAX_ATTACHMENTS}
              aria-label="Adjuntar archivo"
              title="Adjuntar archivo"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-40"
            >
              {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
            </button>
          </div>
          <textarea
            value={draft}
            onChange={e => {
              setDraft(e.target.value)
              if (e.target.value.trim()) broadcastTyping()
            }}
            onKeyDown={onKeyDown}
            rows={1}
            placeholder="Escribe al canal General…  (Enter para enviar, Shift+Enter salto de línea)"
            className="flex-1 resize-none max-h-32 px-3 py-2 rounded-lg border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            onClick={send}
            disabled={sending || uploading || (draft.trim().length === 0 && pendingCount === 0)}
            aria-label="Enviar mensaje"
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-40 hover:bg-primary/90 transition-colors"
          >
            {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Enviar
          </button>
        </div>
      </div>
      )}
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

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 1024) return `${bytes || 0} B`
  const units = ['KB', 'MB', 'GB']
  let val = bytes / 1024
  let i = 0
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val.toFixed(val >= 10 ? 0 : 1)} ${units[i]}`
}

// Render de un adjunto de archivo: imagenes se previsualizan; el resto es un chip
// descargable. La URL (signed o local) llega por prop.
function FileAttachmentView({ att, url, mine }: { att: FileAttachment; url?: string; mine: boolean }) {
  const isImage = att.mime.startsWith('image/')

  if (isImage) {
    if (!url) {
      return (
        <div className="flex h-32 w-48 items-center justify-center rounded-xl border border-border bg-muted/40">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      )
    }
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={att.name}
          className="max-h-56 max-w-[15rem] rounded-xl border border-border object-cover"
        />
      </a>
    )
  }

  return (
    <a
      href={url || undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex max-w-[15rem] items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors',
        mine
          ? 'border-primary/30 bg-primary/5 hover:bg-primary/10'
          : 'border-border bg-muted/40 hover:bg-muted',
        !url && 'pointer-events-none opacity-70'
      )}
    >
      <FileText className="h-4 w-4 flex-shrink-0 text-primary" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-foreground">{att.name}</span>
        <span className="block text-[10px] text-muted-foreground">{formatBytes(att.size)}</span>
      </span>
      {url ? (
        <Download className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 flex-shrink-0 animate-spin text-muted-foreground" />
      )}
    </a>
  )
}

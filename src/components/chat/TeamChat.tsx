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
import { MessageSquare, Loader2, ListChecks, X, SmilePlus, Paperclip, Download, FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { compressImageForUpload } from '@/lib/image-compress'
import { TaskAttachPicker, type PickerTask } from './TaskAttachPicker'
import { TaskCardChip, type ResolvedTaskCard } from './TaskCardChip'
import { ReminderButton } from './ReminderButton'

// Set de emojis del picker. Debe coincidir con el whitelist del endpoint
// /api/teams/[teamId]/messages/[messageId]/reactions para que el toggle sea
// consistente entre cliente y servidor.
const EMOJIS = ['👍', '❤️', '😄', '🎉', '🙌', '👀', '🔥', '✅'] as const

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

interface TaskAttachment {
  type: 'task'
  task_id: string
}
interface FileAttachment {
  type: 'file'
  path: string
  name: string
  mime: string
  size: number
}
type Attachment = TaskAttachment | FileAttachment

// Archivo subido y listo para adjuntar (aún no enviado). Guardamos el File para
// previsualizar localmente sin esperar la signed URL del servidor.
interface PendingFile {
  path: string
  name: string
  mime: string
  size: number
  localUrl?: string
}

const MAX_ATTACHMENTS = 5

// Marca interna para distinguir un fallo de red (la petición nunca llegó al
// servidor) de un rechazo HTTP (el servidor respondió con error).
const NETWORK_ERR = '__network__'

// POST del mensaje con reintento SEGURO: solo reintenta cuando fetch se rechaza
// (fallo de red antes de tocar el servidor), nunca ante un HTTP no-ok, porque en
// ese caso el mensaje pudo haberse insertado y reintentar lo duplicaría. Backoff
// 300ms, 900ms; tras 2 reintentos lanza NETWORK_ERR.
async function postMessage(payload: unknown, attempt = 0): Promise<Response> {
  try {
    return await fetch('/api/messages', {
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

interface Message {
  id: string
  author_id: string
  body: string
  created_at: string
  attachments?: Attachment[] | null
}

interface TeamChatProps {
  teamId: string
  currentUserId: string
  members: Member[]
  initialMessages: Message[]
  initialReactions?: Reaction[]
}

export function TeamChat({ teamId, currentUserId, members, initialMessages, initialReactions = [] }: TeamChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [reactions, setReactions] = useState<Reaction[]>(initialReactions)
  const [pickerFor, setPickerFor] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  // Historial: asumimos que hay más si la carga inicial vino "llena".
  const [hasMore, setHasMore] = useState(initialMessages.length >= 20)
  const [loadingMore, setLoadingMore] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const prependingRef = useRef(false)

  // Presencia y "escribiendo…" sobre el mismo canal Realtime del chat.
  // channelRef expone el canal para poder emitir broadcasts de tecleo.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const channelRef = useRef<any>(null)
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set())
  const [typingIds, setTypingIds] = useState<Record<string, number>>({}) // id -> última señal (ms)
  const lastTypingSentRef = useRef(0)

  // Adjuntos de tarea: cola pendiente (antes de enviar) y buscador abierto.
  const [pendingTasks, setPendingTasks] = useState<PickerTask[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  // Adjuntos de archivo: cola pendiente + estado de subida + input oculto.
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Cache de signed URLs de archivos (path -> url). Se resuelve al render.
  const [fileUrls, setFileUrls] = useState<Record<string, string>>({})

  // Cache de tarjetas resueltas. undefined = aún no cargada; null = no disponible.
  const [taskCards, setTaskCards] = useState<Record<string, ResolvedTaskCard | null>>({})

  const pendingCount = pendingTasks.length + pendingFiles.length

  const memberById = useMemo(() => {
    const m = new Map<string, Member>()
    for (const mem of members) m.set(mem.id, mem)
    return m
  }, [members])

  // Reacciones agrupadas por mensaje, y dentro por emoji (pills con conteo y si
  // la persona actual ya reaccionó).
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

  // Dedupe de reacciones por id (INSERT propio + realtime pueden coincidir).
  function upsertReaction(r: Reaction) {
    setReactions(prev => (prev.some(x => x.id === r.id) ? prev : [...prev, r]))
  }
  function removeReaction(id: string) {
    setReactions(prev => prev.filter(x => x.id !== id))
  }

  // Escape cierra el picker de reacciones (el overlay solo cubre click/touch).
  useEffect(() => {
    if (!pickerFor) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPickerFor(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pickerFor])

  // Alterna una reacción con update optimista; el realtime confirma o corrige.
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
      const res = await fetch(`/api/teams/${teamId}/messages/${messageId}/reactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji }),
      })
      if (!res.ok) throw new Error('reaction failed')
      // Quitar el placeholder; el registro real llega por realtime.
      removeReaction(tempId)
    } catch {
      removeReaction(tempId)
      if (existing) upsertReaction(existing)
      toast.error('No se pudo actualizar la reacción')
    }
  }

  // Resuelve en lote las tarjetas de tarea que aparecen en los mensajes y aún no
  // están en cache. Cubre tanto el historial como los mensajes que llegan por
  // realtime (que traen solo la referencia cruda en attachments).
  useEffect(() => {
    const needed = new Set<string>()
    for (const msg of messages) {
      for (const att of msg.attachments ?? []) {
        if (att.type === 'task' && !(att.task_id in taskCards)) needed.add(att.task_id)
      }
    }
    if (needed.size === 0) return
    let cancelled = false
    const ids = Array.from(needed).slice(0, 30)
    // Marcamos como "en curso" (undefined ya lo está por ausencia); evitamos
    // refetch marcándolas provisionalmente a null si la respuesta no las trae.
    const params = new URLSearchParams({ team_id: teamId, ids: ids.join(',') })
    fetch(`/api/tasks/cards?${params.toString()}`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('cards'))))
      .then((data: { cards: ResolvedTaskCard[] }) => {
        if (cancelled) return
        setTaskCards(prev => {
          const next = { ...prev }
          const found = new Set(data.cards.map(c => c.id))
          for (const c of data.cards) next[c.id] = c
          for (const id of ids) if (!found.has(id)) next[id] = null
          return next
        })
      })
      .catch(() => {
        if (cancelled) return
        setTaskCards(prev => {
          const next = { ...prev }
          for (const id of ids) if (!(id in next)) next[id] = null
          return next
        })
      })
    return () => { cancelled = true }
  }, [messages, teamId, taskCards])

  // Resuelve en lote las signed URLs de los archivos que aparecen en el hilo y
  // aún no están en cache (historial + realtime). Las URLs caducan (~1h) pero al
  // volver a montar/paginar se re-piden; suficiente para la sesión.
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
    fetch(`/api/teams/${teamId}/chat-files/sign?${params.toString()}`)
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
  }, [messages, teamId, fileUrls])

  function addPendingTask(task: PickerTask) {
    setPendingTasks(prev => {
      if (prev.some(t => t.id === task.id) || pendingCount >= MAX_ATTACHMENTS) return prev
      return [...prev, task]
    })
    setPickerOpen(false)
  }

  function removePendingTask(id: string) {
    setPendingTasks(prev => prev.filter(t => t.id !== id))
  }

  function removePendingFile(path: string) {
    setPendingFiles(prev => {
      const gone = prev.find(f => f.path === path)
      if (gone?.localUrl) URL.revokeObjectURL(gone.localUrl)
      return prev.filter(f => f.path !== path)
    })
  }

  // Sube los archivos elegidos (uno por uno) al endpoint del equipo y los agrega
  // a la cola pendiente. Respeta el tope combinado de adjuntos.
  async function onFilesChosen(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return
    const files = Array.from(fileList)
    setUploading(true)
    try {
      for (const elegido of files) {
        if (pendingCount + 1 > MAX_ATTACHMENTS) {
          toast.error(`Máximo ${MAX_ATTACHMENTS} adjuntos por mensaje`)
          break
        }
        // Se comprime ANTES de revisar el tope: una foto de celular de 6MB pasa
        // a ~300KB y entra sin problema. Revisar primero rechazaria adjuntos que
        // en realidad si caben. Si no es imagen, devuelve el original intacto.
        const file = await compressImageForUpload(elegido)
        if (file.size > 25 * 1024 * 1024) {
          toast.error(`"${file.name}" supera el límite de 25MB`)
          continue
        }
        const form = new FormData()
        form.append('file', file)
        try {
          const res = await fetch(`/api/teams/${teamId}/chat-files`, { method: 'POST', body: form })
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

  // Append sin duplicar (dedupe por id).
  function upsertMessage(msg: Message) {
    setMessages(prev => {
      if (prev.some(m => m.id === msg.id)) return prev
      return [...prev, msg]
    })
  }

  // ── Realtime: mensajes + reacciones + presencia + tecleo ──────────────────
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase
      .channel(`chat-${teamId}`, {
        config: { presence: { key: currentUserId }, broadcast: { self: false } },
      })
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `team_id=eq.${teamId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const row = payload.new as Message
          upsertMessage(row)
          // Al llegar un mensaje del autor, deja de mostrarlo como "escribiendo".
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
        { event: 'INSERT', schema: 'public', table: 'team_message_reactions', filter: `team_id=eq.${teamId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => { upsertReaction(payload.new as Reaction) }
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'DELETE', schema: 'public', table: 'team_message_reactions', filter: `team_id=eq.${teamId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => { if (payload.old?.id) removeReaction(payload.old.id as string) }
      )
      // Tecleo en vivo: cada emisor difunde su id; se registra con timestamp y
      // caduca solo (efecto de poda). No toca la base de datos.
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
      // Presencia: quién está mirando el chat ahora mismo.
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
  }, [teamId, currentUserId])

  // Poda de señales de tecleo: quita las mayores a 4s. El intervalo también
  // fuerza el re-render que refresca el indicador cuando alguien deja de teclear.
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

  // Difunde "escribiendo…" a lo sumo cada 1.5s mientras el usuario teclea.
  function broadcastTyping() {
    const now = Date.now()
    if (now - lastTypingSentRef.current < 1500) return
    lastTypingSentRef.current = now
    channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { id: currentUserId } })
  }

  // Nombres de quienes están escribiendo ahora (excluye al propio usuario).
  const typingNames = useMemo(
    () =>
      Object.keys(typingIds)
        .filter(id => id !== currentUserId)
        .map(id => memberById.get(id)?.display_name ?? 'Alguien'),
    [typingIds, currentUserId, memberById]
  )

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
    const tasks = pendingTasks
    const files = pendingFiles
    if ((!body && tasks.length === 0 && files.length === 0) || sending || uploading) return
    setSending(true)
    setDraft('')
    setPendingTasks([])
    setPendingFiles([])
    // Sembramos la cache con las tarjetas que ya conocemos del picker, para que
    // el chip aparezca resuelto de inmediato sin esperar el fetch.
    if (tasks.length > 0) {
      setTaskCards(prev => {
        const next = { ...prev }
        for (const t of tasks) {
          if (!(t.id in next)) {
            next[t.id] = {
              id: t.id,
              title: t.title,
              priority: t.priority,
              status: t.status,
              assignee: null,
              href: '',
            }
          }
        }
        return next
      })
    }
    // Sembramos la preview local de imágenes para que se vean al instante sin
    // esperar la signed URL (los demás usuarios la resuelven por su lado).
    if (files.length > 0) {
      setFileUrls(prev => {
        const next = { ...prev }
        for (const f of files) if (f.localUrl && !(f.path in next)) next[f.path] = f.localUrl
        return next
      })
    }
    const attachments: Attachment[] = [
      ...tasks.map(t => ({ type: 'task' as const, task_id: t.id })),
      ...files.map(f => ({ type: 'file' as const, path: f.path, name: f.name, mime: f.mime, size: f.size })),
    ]
    const payload = {
      team_id: teamId,
      body,
      ...(attachments.length > 0 ? { attachments } : {}),
    }
    try {
      const res = await postMessage(payload)
      if (!res.ok) {
        // Superamos el genérico: mostramos el motivo real que reporta la API
        // (p. ej. "Sin acceso al equipo", "Datos inválidos") para no dejar al
        // usuario a ciegas cuando algo falla de verdad.
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
      // Restaurar el borrador y los adjuntos para que el usuario reintente sin
      // reescribir ni re-subir nada.
      setDraft(body)
      setPendingTasks(tasks)
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
                    {/* Punto de presencia: el autor está viendo el chat ahora. */}
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
                      att.type === 'task' ? (
                        <TaskCardChip
                          key={att.task_id}
                          card={taskCards[att.task_id]}
                          onMine={mine}
                        />
                      ) : att.type === 'file' ? (
                        <FileAttachmentView
                          key={`${att.path}-${ai}`}
                          att={att}
                          url={fileUrls[att.path]}
                          mine={mine}
                        />
                      ) : null
                    )}
                  </div>

                  {/* Acciones del mensaje (aparecen al hover): recordatorio + reaccion. */}
                  <div className={cn('flex items-center gap-0.5', mine && 'flex-row-reverse')}>
                  <ReminderButton
                    teamId={teamId}
                    messageId={msg.id}
                    messageBody={msg.body}
                    members={members}
                    currentUserId={currentUserId}
                    mine={mine}
                    hoverClass="opacity-0 group-hover/msg:opacity-100"
                  />
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
        {/* Indicador de tecleo en vivo (no ocupa espacio si nadie escribe). */}
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
        {/* Adjuntos pendientes de enviar (tareas + archivos) */}
        {(pendingTasks.length > 0 || pendingFiles.length > 0) && (
          <div className="mb-2 flex flex-wrap gap-1.5">
            {pendingTasks.map(t => (
              <span
                key={t.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 pl-2.5 pr-1.5 py-1 text-xs text-foreground"
              >
                <ListChecks className="h-3 w-3 text-primary" />
                <span className="max-w-[10rem] truncate">{t.title}</span>
                <button
                  onClick={() => removePendingTask(t.id)}
                  aria-label={`Quitar ${t.title}`}
                  className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground transition-colors"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
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
          {/* Adjuntar tarea */}
          <div className="relative flex-shrink-0">
            {pickerOpen && (
              <TaskAttachPicker
                teamId={teamId}
                onPick={addPendingTask}
                onClose={() => setPickerOpen(false)}
              />
            )}
            <button
              type="button"
              onClick={() => setPickerOpen(o => !o)}
              aria-label="Adjuntar tarea"
              title="Adjuntar tarea"
              className={cn(
                'inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-colors',
                pickerOpen
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted hover:text-foreground'
              )}
            >
              <ListChecks className="h-4 w-4" />
            </button>
          </div>
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
            placeholder="Escribe un mensaje…  (Enter para enviar, Shift+Enter salto de línea)"
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

// Render de un adjunto de archivo: imágenes se previsualizan; el resto es un chip
// descargable. La URL (signed o local) llega por prop; mientras se resuelve se
// muestra un estado de carga.
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

'use client'

/**
 * Hilo lateral de comentarios de una nota (Conversación A, Circuito A2).
 * Reutiliza el patrón de comentarios de tareas: composer con @menciones,
 * lista de comentarios y notificación al inbox de los mencionados.
 *
 * Las notas son de alcance workspace, así que los mencionables son los
 * miembros del workspace (el server revalida). Los comentarios llegan en vivo
 * por Realtime sobre note_comments.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { AtSign, MessageSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { getInitials, timeAgo } from '@/lib/utils'

interface Member {
  id: string
  display_name: string
  avatar_url: string | null
}

interface Comment {
  id: string
  body: string
  created_at: string
  author: Member | null
}

interface NoteCommentsProps {
  noteId: string
  currentUserId: string
}

// Detecta @menciones en un texto contra la lista de miembros. El server revalida
// contra membresia real del workspace, esto es solo para el envío optimista.
function detectMentionIds(text: string, members: Member[]): string[] {
  const lower = text.toLowerCase()
  const ids: string[] = []
  for (const m of members) {
    const name = m.display_name?.toLowerCase().trim()
    if (name && lower.includes('@' + name)) ids.push(m.id)
  }
  return Array.from(new Set(ids))
}

export function NoteComments({ noteId, currentUserId }: NoteCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const membersRef = useRef<Member[]>([])
  membersRef.current = members

  // Carga inicial: comentarios + miembros mencionables.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [cRes, mRes] = await Promise.all([
          fetch(`/api/notes/${noteId}/comments`),
          fetch(`/api/notes/${noteId}/mentions`),
        ])
        if (alive && cRes.ok) setComments(await cRes.json())
        if (alive && mRes.ok) setMembers(await mRes.json())
      } catch {
        // silencioso: el hilo es secundario, no romper la nota
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
  }, [noteId])

  const upsert = useCallback((c: Comment) => {
    setComments(prev => (prev.some(x => x.id === c.id) ? prev : [...prev, c]))
  }, [])

  // Realtime: comentarios nuevos de otros usuarios. El payload trae la fila
  // cruda (sin el perfil del autor), así que lo resolvemos con la lista de
  // miembros ya cargada.
  useEffect(() => {
    const supabase = createClient()
    const ch = supabase
      .channel(`note-comments-${noteId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'note_comments', filter: `note_id=eq.${noteId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const row = payload.new as { id: string; content: string; created_at: string; author_id: string }
          const author = membersRef.current.find(m => m.id === row.author_id) ?? null
          upsert({ id: row.id, body: row.content, created_at: row.created_at, author })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [noteId, upsert])

  const registerMentions = useCallback(async (text: string) => {
    const ids = detectMentionIds(text, membersRef.current)
    if (ids.length === 0) return
    try {
      await fetch(`/api/notes/${noteId}/mentions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mentioned_ids: ids, source: 'comment' }),
      })
    } catch {
      // la mención es best-effort; el comentario ya se guardó
    }
  }, [noteId])

  const handleAdd = useCallback(async (body: string) => {
    const trimmed = body.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/notes/${noteId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      })
      if (!res.ok) throw new Error()
      const comment: Comment = await res.json()
      upsert(comment)
      registerMentions(trimmed)
    } catch {
      toast.error('Error al enviar el comentario')
      throw new Error('failed')
    } finally {
      setSubmitting(false)
    }
  }, [noteId, upsert, registerMentions])

  return (
    <section className="mt-12 pt-6 border-t border-border">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-4">
        <MessageSquare className="w-3.5 h-3.5" />
        Comentarios {comments.length > 0 && `(${comments.length})`}
      </h3>

      {loading ? (
        <p className="text-sm text-muted-foreground py-2">Cargando comentarios…</p>
      ) : (
        <>
          {comments.length > 0 && (
            <div className="space-y-4 mb-4">
              {comments.map(c => (
                <CommentItem key={c.id} comment={c} currentUserId={currentUserId} />
              ))}
            </div>
          )}
          <CommentComposer members={members} submitting={submitting} onSubmit={handleAdd} />
          <MentionHint members={members} />
        </>
      )}
    </section>
  )
}

// ── Composer con @menciones ───────────────────────────────────────────────────
function CommentComposer({ members, submitting, onSubmit }: {
  members: Member[]
  submitting: boolean
  onSubmit: (body: string) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const suggestions = mentionQuery !== null
    ? members.filter(m => m.display_name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
    : []

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setValue(v)
    const upto = v.slice(0, e.target.selectionStart ?? v.length)
    const match = /(^|\s)@([\w.\-]*)$/.exec(upto)
    setMentionQuery(match ? match[2] : null)
  }

  const pickMention = (m: Member) => {
    const el = taRef.current
    const caret = el?.selectionStart ?? value.length
    const before = value.slice(0, caret).replace(/(^|\s)@([\w.\-]*)$/, `$1@${m.display_name} `)
    const after = value.slice(caret)
    setValue(before + after)
    setMentionQuery(null)
    requestAnimationFrame(() => { el?.focus() })
  }

  const send = async () => {
    if (!value.trim()) return
    try {
      await onSubmit(value)
      setValue('')
      setMentionQuery(null)
    } catch {
      // onSubmit ya notifica el error; conservamos el texto
    }
  }

  return (
    <div className="flex items-start gap-2 relative">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground mt-0.5">
        Yo
      </div>
      <div className="flex-1 relative">
        <textarea
          ref={taRef}
          value={value}
          onChange={onChange}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
            if (e.key === 'Escape') setMentionQuery(null)
          }}
          placeholder="Escribe un comentario… (@ para mencionar, Ctrl+Enter para enviar)"
          rows={2}
          className="w-full text-sm px-3 py-2 border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />

        {mentionQuery !== null && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg py-1 max-h-52 overflow-y-auto">
            {suggestions.map(m => (
              <button
                key={m.id}
                onClick={() => pickMention(m)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left"
              >
                <div className="w-5 h-5 rounded-full overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center text-[9px] font-medium">
                  {m.avatar_url ? (
                    <Image src={m.avatar_url} alt={m.display_name} width={20} height={20} className="object-cover" />
                  ) : getInitials(m.display_name)}
                </div>
                <span className="truncate">{m.display_name}</span>
              </button>
            ))}
          </div>
        )}

        {value.trim() && (
          <button
            onClick={send}
            disabled={submitting}
            className="mt-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Enviando…' : 'Comentar'}
          </button>
        )}
      </div>
    </div>
  )
}

function MentionHint({ members }: { members: Member[] }) {
  if (members.length === 0) return null
  return (
    <p className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1.5">
      <AtSign className="w-3 h-3" />
      Escribe @nombre para mencionar y notificar a un compañero del workspace.
    </p>
  )
}

function CommentItem({ comment, currentUserId }: { comment: Comment; currentUserId: string }) {
  const isOwn = comment.author?.id === currentUserId
  return (
    <div className="flex items-start gap-2.5">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted overflow-hidden flex items-center justify-center text-[10px] font-medium mt-0.5">
        {comment.author?.avatar_url ? (
          <Image src={comment.author.avatar_url} alt={comment.author.display_name} width={24} height={24} className="object-cover" />
        ) : (
          getInitials(comment.author?.display_name ?? '?')
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-foreground">{comment.author?.display_name ?? 'Usuario'}</span>
          <span className="text-[11px] text-muted-foreground">{timeAgo(comment.created_at)}</span>
          {isOwn && <span className="text-[11px] text-muted-foreground ml-auto">Tú</span>}
        </div>
        <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">{comment.body}</p>
      </div>
    </div>
  )
}

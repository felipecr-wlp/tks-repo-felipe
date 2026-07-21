'use client'

/**
 * FloatingChat, burbuja de chat flotante global montada en el layout del
 * workspace. Accesible desde cualquier página. Carga los mensajes y miembros
 * bajo demanda (lazy) via GET /api/messages la primera vez que se abre un
 * equipo, cachea por equipo mientras el panel siga vivo, y reutiliza TeamChat
 * para el hilo en vivo. Indicador de mensajes sin leer por realtime cuando el
 * panel está cerrado.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { MessageSquare, X, Maximize2, ChevronDown, AlertCircle, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { TeamChat } from './TeamChat'

interface TeamRef {
  id: string
  name: string
  slug: string
}

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
  attachments?: { type: 'task'; task_id: string }[] | null
}

interface Reaction {
  id: string
  message_id: string
  profile_id: string
  emoji: string
}

interface LoadedTeam {
  members: Member[]
  initialMessages: Message[]
  initialReactions: Reaction[]
}

interface FloatingChatProps {
  workspaceSlug: string
  currentUserId: string
  teams: TeamRef[]
}

export function FloatingChat({ workspaceSlug, currentUserId, teams }: FloatingChatProps) {
  const [open, setOpen] = useState(false)
  const [activeId, setActiveId] = useState(teams[0]?.id ?? '')
  const [loaded, setLoaded] = useState<Record<string, LoadedTeam>>({})
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [retry, setRetry] = useState(0)
  const [unread, setUnread] = useState(false)
  const openRef = useRef(open)
  openRef.current = open

  const active = teams.find(t => t.id === activeId) ?? teams[0]

  // Cargar mensajes + miembros del equipo activo la primera vez que se abre.
  useEffect(() => {
    if (!open || !active || loaded[active.id]) return
    let cancelled = false
    setLoading(true)
    setLoadError(false)
    fetch(`/api/messages?team_id=${active.id}&limit=30`)
      .then(res => (res.ok ? res.json() : Promise.reject(new Error('load'))))
      .then((data: { messages: Message[]; members: Member[]; reactions?: Reaction[] }) => {
        if (cancelled) return
        setLoaded(prev => ({
          ...prev,
          [active.id]: {
            members: data.members ?? [],
            initialMessages: data.messages ?? [],
            initialReactions: data.reactions ?? [],
          },
        }))
      })
      // Antes: .catch(() => {}) dejaba "Cargando..." infinito sin feedback.
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [open, active, loaded, retry])

  // Indicador de no leídos: escucha INSERT de cualquier equipo del usuario
  // mientras el panel esté cerrado. Ignora los mensajes propios.
  useEffect(() => {
    if (teams.length === 0) return
    const supabase = createClient()
    const ids = new Set(teams.map(t => t.id))
    // Regla de egress 5: filtrar en el servidor a los teams del usuario
    // (el check client-side de abajo queda como respaldo).
    const teamFilter = `team_id=in.(${teams.map(t => t.id).join(',')})`
    const ch = supabase
      .channel('floating-chat-unread')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'public', table: 'messages', filter: teamFilter },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const row = payload.new as { team_id: string; author_id: string }
          if (!ids.has(row.team_id)) return
          if (row.author_id === currentUserId) return
          if (!openRef.current) setUnread(true)
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [teams, currentUserId])

  if (teams.length === 0) return null

  return (
    <>
      {/* Panel */}
      {open && active && (
        <div className="fixed bottom-40 right-6 z-50 w-[min(380px,calc(100vw-3rem))] h-[min(560px,calc(100vh-12rem))] flex flex-col bg-card border border-border rounded-2xl shadow-overlay overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/40">
            <div className="flex items-center gap-2 min-w-0">
              <MessageSquare className="w-4 h-4 text-primary flex-shrink-0" />
              <span className="text-sm font-semibold text-foreground truncate">Chat de equipo</span>
            </div>
            <div className="flex items-center gap-1">
              <Link
                href={`/w/${workspaceSlug}/t/${active.slug}/chat`}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Abrir en pantalla completa"
                aria-label="Abrir chat en pantalla completa"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </Link>
              <button
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Cerrar"
                aria-label="Cerrar panel de chat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Selector de equipo */}
          {teams.length > 1 && (
            <div className="px-3 py-2 border-b border-border">
              <div className="relative">
                <select
                  value={activeId}
                  onChange={e => setActiveId(e.target.value)}
                  className="w-full appearance-none text-xs font-medium bg-background border border-border rounded-lg pl-3 pr-8 py-1.5 text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {teams.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          )}

          {/* Hilo */}
          <div className="flex-1 min-h-0 flex flex-col">
            {loaded[active.id] ? (
              <TeamChat
                key={active.id}
                teamId={active.id}
                currentUserId={currentUserId}
                members={loaded[active.id].members}
                initialMessages={loaded[active.id].initialMessages}
                initialReactions={loaded[active.id].initialReactions}
              />
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2 px-6 text-center">
                {loadError ? (
                  <>
                    <AlertCircle className="w-5 h-5 text-destructive" />
                    <p className="text-xs text-muted-foreground">No se pudo cargar la conversación.</p>
                    <button
                      onClick={() => setRetry(n => n + 1)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors"
                    >
                      <RotateCcw className="w-3 h-3" /> Reintentar
                    </button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {loading ? 'Cargando conversación…' : 'Preparando chat…'}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Burbuja */}
      <button
        onClick={() => { setOpen(o => !o); setUnread(false) }}
        className={cn(
          'fixed bottom-[5.5rem] right-6 z-50 w-14 h-14 rounded-full shadow-raised flex items-center justify-center transition-all',
          'bg-primary text-primary-foreground hover:scale-105 active:scale-95'
        )}
        title={open ? 'Cerrar chat' : 'Abrir chat de equipo'}
        aria-label={open ? 'Cerrar chat de equipo' : 'Abrir chat de equipo'}
      >
        {open ? <X className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
        {!open && unread && (
          <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-background" />
        )}
      </button>
    </>
  )
}

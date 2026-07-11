'use client'

/**
 * Lista de notificaciones, agrupada por leído/no leído.
 * Permite marcar individual o todo como leído, click navega al objeto.
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { cn, getInitials, timeAgo } from '@/lib/utils'

interface Notification {
  id: string
  type: string
  object_type: string | null
  object_id: string | null
  object_title: string | null
  is_read: boolean
  created_at: string
  subject: { id: string; display_name: string; avatar_url: string | null } | null
}

interface InboxListProps {
  initial: Notification[]
  workspaceSlug: string
}

const VERB_LABELS: Record<string, string> = {
  'task.assigned':        'te asignó la tarea',
  'task.unassigned':      'te quitó la tarea',
  'task.status_changed':  'cambió el estado de',
  'task.due_set':         'puso fecha a',
  'task.priority_set':    'cambió la prioridad de',
  'comment.added':        'comentó en',
  'comment.mention':      'te mencionó en',
  'task_mentioned':       'te mencionó en',
  'note_mentioned':       'te mencionó en la nota',
  'task_updated':         'actualizó la tarea que sigues',
  'project.member_added': 'te agregó al proyecto',
  'workspace.member_joined': 'se unió al workspace',
}

export function InboxList({ initial, workspaceSlug }: InboxListProps) {
  const router = useRouter()
  const [notifications, setNotifications] = useState(initial)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [marking, setMarking] = useState(false)

  // Colaboración en vivo: nuevas notificaciones aparecen sin recargar.
  useRealtimeRefresh({ channel: `inbox-${workspaceSlug}`, tables: ['notifications'] })
  useEffect(() => { setNotifications(initial) }, [initial])

  const unreadCount = notifications.filter(n => !n.is_read).length
  const filtered = filter === 'unread'
    ? notifications.filter(n => !n.is_read)
    : notifications

  async function markRead(id: string) {
    // Optimistic
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    try {
      await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_read: true }),
      })
    } catch {
      // Revert
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: false } : n))
    }
  }

  async function markAllRead() {
    if (unreadCount === 0 || marking) return
    setMarking(true)
    const before = notifications
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    try {
      const res = await fetch(`/api/notifications/mark-all-read`, { method: 'POST' })
      if (!res.ok) throw new Error()
      toast.success(`${unreadCount} notificación(es) marcadas como leídas`)
    } catch {
      setNotifications(before)
      toast.error('Error al marcar todo como leído')
    } finally {
      setMarking(false)
    }
  }

  function handleClick(notif: Notification) {
    if (!notif.is_read) markRead(notif.id)
    // Navegar al objeto si aplica.
    if (notif.object_type === 'note' && notif.object_id) {
      router.push(`/w/${workspaceSlug}/notes/${notif.object_id}`)
      return
    }
    if (notif.object_type === 'task' && notif.object_id) {
      // TODO: abrir TaskDetailPanel desde inbox cuando esté contextual
      router.refresh()
    }
  }

  if (notifications.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border p-12 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-muted text-muted-foreground mb-3">
          <InboxEmpty />
        </div>
        <h3 className="text-sm font-medium text-foreground mb-1">
          Bandeja vacía
        </h3>
        <p className="text-sm text-muted-foreground">
          Cuando alguien te asigne una tarea o te mencione, aparecerá aquí.
        </p>
      </div>
    )
  }

  return (
    <div>
      {/* Filtros + acción */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
          <FilterPill
            active={filter === 'all'}
            onClick={() => setFilter('all')}
            label="Todas"
            count={notifications.length}
          />
          <FilterPill
            active={filter === 'unread'}
            onClick={() => setFilter('unread')}
            label="Sin leer"
            count={unreadCount}
            highlight={unreadCount > 0}
          />
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            disabled={marking}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Marcar todo como leído
          </button>
        )}
      </div>

      {/* Lista */}
      <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
        {filtered.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-10">
            No hay notificaciones sin leer
          </p>
        ) : (
          filtered.map(notif => (
            <button
              key={notif.id}
              onClick={() => handleClick(notif)}
              className={cn(
                'w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors group relative',
                !notif.is_read && 'bg-primary/[0.03]'
              )}
            >
              {!notif.is_read && (
                <span className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-primary" />
              )}

              {/* Avatar */}
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted overflow-hidden flex items-center justify-center">
                {notif.subject?.avatar_url ? (
                  <Image
                    src={notif.subject.avatar_url}
                    alt={notif.subject.display_name}
                    width={32}
                    height={32}
                    className="object-cover"
                  />
                ) : (
                  <span className="text-[11px] font-medium text-muted-foreground">
                    {getInitials(notif.subject?.display_name ?? '?')}
                  </span>
                )}
              </div>

              {/* Contenido */}
              <div className="flex-1 min-w-0">
                <p className={cn(
                  'text-sm leading-snug',
                  !notif.is_read ? 'text-foreground' : 'text-muted-foreground'
                )}>
                  <span className="font-medium text-foreground">
                    {notif.subject?.display_name ?? 'Sistema'}
                  </span>{' '}
                  <span className={!notif.is_read ? 'text-foreground/80' : ''}>
                    {VERB_LABELS[notif.type] ?? notif.type}
                  </span>
                  {notif.object_title && (
                    <>
                      {' '}
                      <span className="font-medium text-foreground">
                        {notif.object_title}
                      </span>
                    </>
                  )}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {timeAgo(notif.created_at)}
                </p>
              </div>

              {/* Mark as read button (hover) */}
              {!notif.is_read && (
                <button
                  onClick={e => { e.stopPropagation(); markRead(notif.id) }}
                  className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all p-1 rounded hover:bg-background"
                  title="Marcar como leído"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              )}
            </button>
          ))
        )}
      </div>

      <p className="text-[11px] text-muted-foreground mt-3 text-center">
        Workspace: <span className="font-mono">{workspaceSlug}</span>
      </p>
    </div>
  )
}

function FilterPill({
  active, onClick, label, count, highlight,
}: {
  active: boolean
  onClick: () => void
  label: string
  count: number
  highlight?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors',
        active
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {label}
      {count > 0 && (
        <span className={cn(
          'text-[10px] px-1.5 py-0.5 rounded',
          highlight && !active
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        )}>
          {count}
        </span>
      )}
    </button>
  )
}

function InboxEmpty() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  )
}

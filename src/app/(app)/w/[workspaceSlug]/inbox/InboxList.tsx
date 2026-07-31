'use client'

/**
 * Lista de notificaciones, agrupada por leído/no leído.
 * Permite marcar individual o todo como leído, click navega al objeto.
 */
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { toast } from 'sonner'
import Link from 'next/link'
import { Check, Loader2, ArrowRight, Clock, Inbox as InboxIcon } from 'lucide-react'
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh'
import { cn, getInitials, timeAgo } from '@/lib/utils'
import { EmptyState } from '@/components/ui/EmptyState'
import { ErrorState } from '@/components/ui/ErrorState'
import { useT } from '@/lib/i18n/LanguageProvider'

interface Notification {
  id: string
  type: string
  object_type: string | null
  object_id: string | null
  object_title: string | null
  is_read: boolean
  created_at: string
  snoozed_until?: string | null
  subject: { id: string; display_name: string; avatar_url: string | null } | null
}

// Presets de snooze. Se calculan al vuelo respecto a "ahora".
// Recibe `t` para que las etiquetas respeten el idioma activo.
function snoozePresets(t: (key: string) => string): { label: string; at: Date }[] {
  const now = new Date()
  const inHours = (h: number) => new Date(now.getTime() + h * 3600_000)
  // Esta tarde = hoy a las 17:00 si aun no pasa; si no, en 3 horas.
  const thisAfternoon = new Date(now)
  thisAfternoon.setHours(17, 0, 0, 0)
  const afternoon = thisAfternoon > now ? thisAfternoon : inHours(3)
  // Mañana a las 9:00.
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(9, 0, 0, 0)
  // Próxima semana: lunes a las 9:00.
  const nextWeek = new Date(now)
  nextWeek.setDate(nextWeek.getDate() + ((8 - nextWeek.getDay()) % 7 || 7))
  nextWeek.setHours(9, 0, 0, 0)
  return [
    { label: t('inbox.snooze.in1h'), at: inHours(1) },
    { label: t('inbox.snooze.afternoon'), at: afternoon },
    { label: t('inbox.snooze.tomorrow'), at: tomorrow },
    { label: t('inbox.snooze.nextWeek'), at: nextWeek },
  ]
}

interface InboxListProps {
  initial: Notification[]
  workspaceSlug: string
  currentUserId: string
  loadError?: boolean
}

// Buckets de fecha para la lista, ordenados de mas reciente a mas antiguo.
type DateBucket = 'Hoy' | 'Ayer' | 'Esta semana' | 'Anteriores'
const BUCKET_ORDER: DateBucket[] = ['Hoy', 'Ayer', 'Esta semana', 'Anteriores']
// El bucket es un identificador interno; su etiqueta visible sale del diccionario.
const BUCKET_KEY: Record<DateBucket, string> = {
  'Hoy': 'inbox.bucket.today',
  'Ayer': 'inbox.bucket.yesterday',
  'Esta semana': 'inbox.bucket.thisWeek',
  'Anteriores': 'inbox.bucket.earlier',
}

// Clasifica una notificacion segun su created_at respecto a "ahora" (local).
// "Esta semana" = ultimos 7 dias sin contar hoy/ayer. Funcion pura.
function bucketFor(createdAt: string, now: Date): DateBucket {
  const created = new Date(createdAt)
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const today = startOfDay(now)
  const createdDay = startOfDay(created)
  const dayMs = 86_400_000
  const diffDays = Math.round((today.getTime() - createdDay.getTime()) / dayMs)
  if (diffDays <= 0) return 'Hoy'
  if (diffDays === 1) return 'Ayer'
  if (diffDays <= 7) return 'Esta semana'
  return 'Anteriores'
}

// Agrupa la lista (ya ordenada por created_at desc) en buckets no vacios,
// preservando el orden dentro de cada bucket. Devuelve solo los buckets con
// contenido, en el orden Hoy -> Ayer -> Esta semana -> Anteriores.
function groupByDate(items: Notification[]): { bucket: DateBucket; items: Notification[] }[] {
  const now = new Date()
  const map = new Map<DateBucket, Notification[]>()
  for (const n of items) {
    const b = bucketFor(n.created_at, now)
    const arr = map.get(b)
    if (arr) arr.push(n)
    else map.set(b, [n])
  }
  return BUCKET_ORDER
    .filter(b => map.has(b))
    .map(b => ({ bucket: b, items: map.get(b)! }))
}

// Etiqueta del verbo de notificacion segun su tipo, traducida. Si el tipo no
// tiene traduccion (clave inexistente), t() devuelve la clave sin cambios y
// caemos al tipo crudo para no mostrar "inbox.verb.xxx" al usuario.
function verbLabel(t: (key: string) => string, type: string): string {
  const key = `inbox.verb.${type}`
  const label = t(key)
  return label === key ? type : label
}

export function InboxList({ initial, workspaceSlug, currentUserId, loadError = false }: InboxListProps) {
  const router = useRouter()
  const t = useT()
  const [notifications, setNotifications] = useState(initial)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [marking, setMarking] = useState(false)
  const [snoozeMenu, setSnoozeMenu] = useState<string | null>(null)

  // Colaboración en vivo: nuevas notificaciones aparecen sin recargar.
  useRealtimeRefresh({
    channel: `inbox-${workspaceSlug}`,
    tables: [{ table: 'notifications', filter: `recipient_id=eq.${currentUserId}` }],
  })
  useEffect(() => { setNotifications(initial) }, [initial])

  // Cerrar el menu de snooze al hacer clic fuera o con Escape.
  useEffect(() => {
    if (!snoozeMenu) return
    const close = () => setSnoozeMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSnoozeMenu(null) }
    document.addEventListener('click', close)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('click', close); document.removeEventListener('keydown', onKey) }
  }, [snoozeMenu])

  const unreadCount = notifications.filter(n => !n.is_read).length
  const filtered = filter === 'unread'
    ? notifications.filter(n => !n.is_read)
    : notifications

  // Marca is_read en el servidor para un id (usado por markRead y por Deshacer).
  // Devuelve true si el servidor confirmo el cambio; el llamador decide si
  // revierte el estado optimista.
  async function setRead(id: string, value: boolean): Promise<boolean> {
    try {
      const res = await fetch(`/api/notifications/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_read: value }),
      })
      return res.ok
    } catch {
      return false
    }
  }

  async function markRead(id: string) {
    // Si ya esta leida no hacemos nada: evita un doble PATCH y un toast repetido
    // cuando el click de la fila y el boton de check compiten.
    const target = notifications.find(n => n.id === id)
    if (!target || target.is_read) return
    // Optimista.
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
    const ok = await setRead(id, true)
    if (!ok) {
      // Revertir y avisar.
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: false } : n))
      toast.error(t('inbox.toast.markReadFail'))
      return
    }
    toast.success(t('inbox.toast.marked'), {
      action: {
        label: t('common.undo'),
        onClick: async () => {
          setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: false } : n))
          const undone = await setRead(id, false)
          if (!undone) {
            // Revertir el "deshacer": vuelve a quedar leída.
            setNotifications(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n))
            toast.error(t('inbox.toast.undoFail'))
          }
        },
      },
    })
  }

  async function markAllRead() {
    if (unreadCount === 0 || marking) return
    setMarking(true)
    const before = notifications
    // Ids que realmente cambian (estaban sin leer): son los que Deshacer revierte.
    const affected = before.filter(n => !n.is_read).map(n => n.id)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
    try {
      const res = await fetch(`/api/notifications/mark-all-read`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace: workspaceSlug }),
      })
      if (!res.ok) throw new Error()
      toast.success(`${affected.length} ${t('inbox.toast.markedAllSuffix')}`, {
        action: {
          label: t('common.undo'),
          onClick: () => {
            setNotifications(prev => prev.map(n => affected.includes(n.id) ? { ...n, is_read: false } : n))
            // No hay endpoint bulk de "no leído": se revierte una por una.
            affected.forEach(id => setRead(id, false))
          },
        },
      })
    } catch {
      setNotifications(before)
      toast.error(t('inbox.toast.markAllFail'))
    } finally {
      setMarking(false)
    }
  }

  // Posponer: oculta la notificacion de la bandeja hasta la hora elegida y deja
  // un toast con Deshacer que la revive de inmediato.
  async function snooze(notif: Notification, at: Date, label: string) {
    const before = notifications
    setNotifications(prev => prev.filter(n => n.id !== notif.id))
    try {
      const res = await fetch(`/api/notifications/${notif.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snoozed_until: at.toISOString() }),
      })
      if (!res.ok) throw new Error()
      toast.success(`${t('inbox.toast.snoozedPrefix')} ${label.toLowerCase()}`, {
        action: {
          label: 'Deshacer',
          onClick: () => {
            setNotifications(before)
            setSnoozeMenu(null)
            fetch(`/api/notifications/${notif.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ snoozed_until: null }),
            }).catch(() => {})
          },
        },
      })
    } catch {
      setNotifications(before)
      toast.error(t('inbox.toast.snoozeFail'))
    } finally {
      setSnoozeMenu(null)
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
      // Deep-link al resolutor: resuelve la ruta del proyecto y abre la tarea.
      router.push(`/w/${workspaceSlug}/task/${notif.object_id}`)
      return
    }
    if (notif.object_type === 'daily_report') {
      // El dia viaja en el titulo (object_id es uuid y aqui no hay fila propia
      // que apuntar: el reporte todavia no existe, ese es justo el aviso).
      const dia = notif.object_title
      router.push(`/w/${workspaceSlug}/reportes${dia ? `?d=${dia}` : ''}`)
      return
    }
  }

  // Error de carga: la consulta del servidor fallo. Reintentar recarga la ruta.
  if (loadError && notifications.length === 0) {
    return (
      <ErrorState
        title={t('inbox.errorTitle')}
        description={t('inbox.errorDesc')}
        onRetry={() => router.refresh()}
      />
    )
  }

  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={<InboxIcon className="h-5 w-5" />}
        title={t('inbox.emptyTitle')}
        description={t('inbox.emptyDesc')}
        action={
          <Link
            href={`/w/${workspaceSlug}/my-tasks`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors"
          >
            {t('inbox.emptyAction')} <ArrowRight className="w-3 h-3" />
          </Link>
        }
      />
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
            label={t('inbox.filterAll')}
            count={notifications.length}
          />
          <FilterPill
            active={filter === 'unread'}
            onClick={() => setFilter('unread')}
            label={t('inbox.filterUnreadShort')}
            count={unreadCount}
            highlight={unreadCount > 0}
          />
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            disabled={marking}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            {marking && <Loader2 className="w-3 h-3 animate-spin" />}
            {t('inbox.markAllRead')}
          </button>
        )}
      </div>

      {/* Lista agrupada por fecha */}
      {filtered.length === 0 ? (
        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <p className="text-center text-sm text-muted-foreground py-10">
            {t('inbox.noneUnread')}
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {groupByDate(filtered).map(group => (
            <section key={group.bucket}>
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5 px-1">
                {t(BUCKET_KEY[group.bucket])}
              </h2>
              <div className="bg-card border border-border rounded-xl divide-y divide-border overflow-hidden">
                {group.items.map(notif => (
                  <div
                    key={notif.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => handleClick(notif)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(notif) } }}
                    className={cn(
                      'w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-accent/50 transition-colors group relative cursor-pointer',
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
                          {notif.subject?.display_name ?? t('inbox.system')}
                        </span>{' '}
                        <span className={!notif.is_read ? 'text-foreground/80' : ''}>
                          {verbLabel(t, notif.type)}
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

                    {/* Acciones (hover): posponer + marcar leído */}
                    <div className="flex-shrink-0 flex items-center gap-0.5 relative">
                      <button
                        onClick={e => { e.stopPropagation(); setSnoozeMenu(snoozeMenu === notif.id ? null : notif.id) }}
                        className={cn(
                          'text-muted-foreground hover:text-foreground transition-all p-1 rounded hover:bg-background',
                          snoozeMenu === notif.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                        )}
                        title={t('inbox.snooze')}
                        aria-label={t('inbox.snooze')}
                      >
                        <Clock className="w-3.5 h-3.5" />
                      </button>

                      {snoozeMenu === notif.id && (
                        <div
                          className="absolute right-0 top-8 z-20 w-40 bg-popover border border-border rounded-lg shadow-lg py-1"
                          onClick={e => e.stopPropagation()}
                        >
                          <p className="px-3 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {t('inbox.snoozeUntil')}
                          </p>
                          {snoozePresets(t).map(p => (
                            <button
                              key={p.label}
                              onClick={e => { e.stopPropagation(); snooze(notif, p.at, p.label) }}
                              className="w-full text-left px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      )}

                      {!notif.is_read && (
                        <button
                          onClick={e => { e.stopPropagation(); markRead(notif.id) }}
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground transition-all p-1 rounded hover:bg-background"
                          title={t('inbox.markReadAction')}
                          aria-label={t('inbox.markReadAction')}
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground mt-4 text-center">
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

'use client'

/**
 * Seguidores (watchers) de una tarea, para el panel de detalle. Circuito B10.
 *
 * Un boton "Seguir / Siguiendo" alterna MI propio seguimiento; los avatares
 * apilados muestran a todos los seguidores. Seguir una tarea = recibir una
 * notificacion en la bandeja cada vez que la tarea cambia, aunque no seas
 * asignado. Autocontenido por taskId; persiste en task_watchers via
 * /api/tasks/[taskId]/watchers. Realtime: los cambios de otros aparecen sin
 * recargar por el canal del panel (opcional; aqui basta con refetch local).
 */
import { useEffect, useState, useCallback } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'

interface Member { id: string; display_name: string; avatar_url: string | null }

interface WatchersSectionProps {
  taskId: string
  currentUserId: string
}

export function WatchersSection({ taskId, currentUserId }: WatchersSectionProps) {
  const [watchers, setWatchers] = useState<Member[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/watchers`)
      if (res.ok) {
        const data = await res.json()
        setWatchers(data.watchers ?? [])
      }
    } catch {
      /* silencioso: no romper el panel */
    }
  }, [taskId])

  useEffect(() => { load() }, [load])

  const watching = watchers.some(w => w.id === currentUserId)

  async function toggle() {
    if (busy) return
    setBusy(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/watchers`, { method: 'POST' })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? '')
      }
      const data = await res.json()
      setWatchers(data.watchers ?? [])
      toast.success(data.watching ? 'Siguiendo esta tarea' : 'Dejaste de seguir la tarea')
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Error al actualizar el seguimiento')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <button
        onClick={toggle}
        disabled={busy}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border transition-colors disabled:opacity-50',
          watching
            ? 'bg-primary/10 border-primary/30 text-primary hover:bg-primary/15'
            : 'bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-primary/40',
        )}
        title={watching ? 'Dejar de seguir esta tarea' : 'Seguir para recibir notificaciones de cambios'}
      >
        {busy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : watching ? (
          <Eye className="w-3.5 h-3.5" />
        ) : (
          <EyeOff className="w-3.5 h-3.5" />
        )}
        {watching ? 'Siguiendo' : 'Seguir'}
      </button>

      {watchers.length > 0 && (
        <div className="flex items-center -space-x-1.5" title={watchers.map(w => w.display_name).join(', ')}>
          {watchers.slice(0, 5).map(w => (
            <span key={w.id} className="w-5 h-5 rounded-full overflow-hidden bg-muted ring-2 ring-background flex-shrink-0">
              {w.avatar_url ? (
                <Image src={w.avatar_url} alt={w.display_name} width={20} height={20} className="object-cover" />
              ) : (
                <span className="flex items-center justify-center w-full h-full text-[8px] font-medium">{getInitials(w.display_name)}</span>
              )}
            </span>
          ))}
          {watchers.length > 5 && (
            <span className="w-5 h-5 rounded-full bg-muted ring-2 ring-background flex items-center justify-center text-[8px] font-medium text-muted-foreground">
              +{watchers.length - 5}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

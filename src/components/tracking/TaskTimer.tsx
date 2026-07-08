'use client'

/**
 * TaskTimer: boton play/stop con cronometro vivo para una tarea.
 *
 * Solo puede haber UN timer activo por persona (lo garantiza el indice unico
 * te_one_running en la BD). Si el usuario intenta iniciar otro mientras hay uno
 * corriendo, la API responde 409 y se muestra un aviso.
 *
 * Iconos lucide (Play / Square), sin emojis. Al iniciar/parar refresca la ruta
 * para que "Mis tareas" y el timesheet reflejen el cambio.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Play, Square, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface RunningTimer {
  id: string
  started_at: string
}

interface TaskTimerProps {
  taskId: string
  /** Si esta tarea tiene un timer corriendo, se pasa aqui para arrancar en vivo. */
  initialRunning?: RunningTimer | null
  className?: string
}

/** Formatea segundos como H:MM:SS (o MM:SS si es menos de una hora). */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function TaskTimer({ taskId, initialRunning, className }: TaskTimerProps) {
  const router = useRouter()
  const [running, setRunning] = useState<RunningTimer | null>(initialRunning ?? null)
  const [elapsed, setElapsed] = useState(0)
  const [busy, setBusy] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sincroniza si el server manda un estado nuevo (p. ej. tras refresh).
  useEffect(() => { setRunning(initialRunning ?? null) }, [initialRunning])

  // Cronometro vivo mientras hay timer corriendo.
  useEffect(() => {
    if (!running) {
      setElapsed(0)
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null }
      return
    }
    const startMs = new Date(running.started_at).getTime()
    const tick = () => setElapsed((Date.now() - startMs) / 1000)
    tick()
    intervalRef.current = setInterval(tick, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [running])

  const start = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/time-entries/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo iniciar el timer')
      setRunning({ id: data.id, started_at: data.started_at })
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al iniciar')
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/time-entries/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo detener el timer')
      setRunning(null)
      toast.success('Tiempo registrado')
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al detener')
    } finally {
      setBusy(false)
    }
  }

  const isRunning = !!running

  return (
    <button
      type="button"
      onClick={isRunning ? stop : start}
      disabled={busy}
      title={isRunning ? 'Detener timer' : 'Iniciar timer'}
      className={cn(
        'flex-shrink-0 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium tabular-nums transition-colors disabled:opacity-50',
        isRunning
          ? 'border-red-500/40 bg-red-500/10 text-red-600 hover:bg-red-500/15'
          : 'border-border bg-background text-muted-foreground hover:text-foreground hover:border-ring',
        className,
      )}
    >
      {busy
        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
        : isRunning
          ? <Square className="w-3.5 h-3.5 fill-current" />
          : <Play className="w-3.5 h-3.5 fill-current" />}
      {isRunning
        ? <span>{formatClock(elapsed)}</span>
        : <span>Timer</span>}
    </button>
  )
}

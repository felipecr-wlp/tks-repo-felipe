'use client'

/**
 * Seccion de tiempo registrado dentro del TaskDetailPanel.
 *
 * Muestra el total acumulado por el equipo en la tarea, un boton para iniciar o
 * detener el timer propio, un alta manual rapida en minutos y la lista de
 * entradas recientes. Lee el resumen de /api/tasks/[taskId]/time y escribe via
 * los endpoints existentes /api/time-entries/{start,stop} y POST /api/time-entries.
 *
 * Autocontenida por taskId. `onTotalChange` (opcional) sube el total en segundos
 * para que el panel pueda mostrar un contraste estimacion vs real.
 */
import { useCallback, useEffect, useState } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { Timer, Play, Square, Plus, Loader2 } from 'lucide-react'
import { cn, getInitials, timeAgo } from '@/lib/utils'

interface Author { id: string; display_name: string; avatar_url: string | null }
interface Entry {
  id: string
  profile: Author | null
  started_at: string
  ended_at: string | null
  duration_sec: number | null
  note: string | null
}

interface TimeTrackingSectionProps {
  taskId: string
  onTotalChange?: (totalSec: number) => void
}

// Segundos -> "2h 15m" / "45m" / "30s".
function fmtDuration(sec: number): string {
  if (sec <= 0) return '0m'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  if (m > 0) return `${m}m`
  return `${sec}s`
}

export function TimeTrackingSection({ taskId, onTotalChange }: TimeTrackingSectionProps) {
  const [totalSec, setTotalSec] = useState(0)
  const [runningEntryId, setRunningEntryId] = useState<string | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [manual, setManual] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/time`)
      if (!res.ok) return
      const data = await res.json()
      setTotalSec(data.totalSec ?? 0)
      setRunningEntryId(data.runningEntryId ?? null)
      setEntries(data.entries ?? [])
      onTotalChange?.(data.totalSec ?? 0)
    } catch {
      /* silencioso: no romper el panel */
    } finally {
      setLoading(false)
    }
  }, [taskId, onTotalChange])

  useEffect(() => { load() }, [load])

  async function toggleTimer() {
    if (busy) return
    setBusy(true)
    try {
      const running = !!runningEntryId
      const res = running
        ? await fetch('/api/time-entries/stop', { method: 'POST' })
        : await fetch('/api/time-entries/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ task_id: taskId }),
          })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? '')
      }
      await load()
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Error con el timer')
    } finally {
      setBusy(false)
    }
  }

  async function addManual() {
    const mins = parseInt(manual, 10)
    if (!Number.isFinite(mins) || mins <= 0) { setManual(''); return }
    setBusy(true)
    try {
      const ended = new Date()
      const started = new Date(ended.getTime() - mins * 60_000)
      const res = await fetch('/api/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId, started_at: started.toISOString(), ended_at: ended.toISOString() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? '')
      }
      setManual('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Error al registrar el tiempo')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <Timer className="w-3.5 h-3.5" /> Tiempo
          {totalSec > 0 && (
            <span className="ml-0.5 normal-case tracking-normal text-foreground font-semibold">{fmtDuration(totalSec)}</span>
          )}
        </p>
        <button
          onClick={toggleTimer}
          disabled={busy || loading}
          className={cn(
            'flex items-center gap-1 text-[11px] px-2 py-0.5 rounded transition-colors disabled:opacity-50',
            runningEntryId
              ? 'bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/20'
              : 'text-muted-foreground hover:text-primary',
          )}
        >
          {busy
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : runningEntryId
              ? <><Square className="w-3 h-3" /> Detener</>
              : <><Play className="w-3 h-3" /> Iniciar</>}
        </button>
      </div>

      <div className="flex items-center gap-1.5 mb-2">
        <input
          value={manual}
          onChange={e => setManual(e.target.value.replace(/[^0-9]/g, ''))}
          onKeyDown={e => { if (e.key === 'Enter') addManual() }}
          placeholder="Minutos"
          inputMode="numeric"
          className="w-24 text-sm bg-transparent border border-border rounded px-2 py-1 outline-none focus:border-primary placeholder:text-muted-foreground/60"
        />
        <button
          onClick={addManual}
          disabled={busy || !manual}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors disabled:opacity-40"
        >
          <Plus className="w-3 h-3" /> Agregar
        </button>
      </div>

      {entries.length > 0 && (
        <div className="space-y-0.5">
          {entries.slice(0, 6).map(e => (
            <div key={e.id} className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/40 transition-colors">
              <span className="w-5 h-5 rounded-full overflow-hidden bg-muted flex-shrink-0">
                {e.profile?.avatar_url ? (
                  <Image src={e.profile.avatar_url} alt={e.profile.display_name} width={20} height={20} className="object-cover" />
                ) : (
                  <span className="flex items-center justify-center w-full h-full text-[9px] font-medium">{getInitials(e.profile?.display_name ?? '?')}</span>
                )}
              </span>
              <span className="text-xs text-foreground flex-shrink-0">
                {e.ended_at === null ? <span className="text-red-500">en curso</span> : fmtDuration(e.duration_sec ?? 0)}
              </span>
              {e.note && <span className="text-xs text-muted-foreground truncate flex-1">{e.note}</span>}
              <span className="text-[11px] text-muted-foreground/70 ml-auto flex-shrink-0">{timeAgo(e.started_at)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

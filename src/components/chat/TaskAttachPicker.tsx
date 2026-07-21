'use client'

/**
 * TaskAttachPicker, buscador flotante de tareas para adjuntar al chat (1.A).
 *
 * Abre un popover sobre el compositor, busca tareas del equipo via
 * /api/tasks/search (debounce) y llama onPick con la tarea elegida. No decide
 * el estado de los adjuntos pendientes: eso lo maneja el compositor.
 */
import { useEffect, useRef, useState } from 'react'
import { Search, Loader2, ListChecks, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface PickerTask {
  id: string
  title: string
  priority: string
  status: { name: string; color: string | null } | null
  project_name: string
}

const PRIORITY_DOT: Record<string, string> = {
  none: 'bg-muted-foreground/40',
  low: 'bg-sky-500',
  medium: 'bg-amber-500',
  high: 'bg-orange-500',
  urgent: 'bg-red-500',
}

interface TaskAttachPickerProps {
  teamId: string
  onPick: (task: PickerTask) => void
  onClose: () => void
}

export function TaskAttachPicker({ teamId, onPick, onClose }: TaskAttachPickerProps) {
  const [q, setQ] = useState('')
  const [tasks, setTasks] = useState<PickerTask[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Cerrar con Escape o click fuera.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  // Buscar con debounce.
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(() => {
      const params = new URLSearchParams({ team_id: teamId, limit: '8' })
      if (q.trim()) params.set('q', q.trim())
      fetch(`/api/tasks/search?${params.toString()}`)
        .then(res => (res.ok ? res.json() : Promise.reject(new Error('search'))))
        .then((data: { tasks: PickerTask[] }) => {
          if (!cancelled) setTasks(data.tasks ?? [])
        })
        .catch(() => { if (!cancelled) setTasks([]) })
        .finally(() => { if (!cancelled) setLoading(false) })
    }, 220)
    return () => { cancelled = true; clearTimeout(t) }
  }, [q, teamId])

  return (
    <div
      ref={boxRef}
      className="absolute bottom-full left-0 mb-2 w-[min(340px,calc(100vw-3rem))] rounded-xl border border-border bg-popover shadow-overlay overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-150"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-muted/40">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <ListChecks className="w-3.5 h-3.5 text-primary" />
          Adjuntar tarea
        </span>
        <button
          onClick={onClose}
          aria-label="Cerrar buscador de tareas"
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-border">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Busca por título…"
            className="w-full rounded-lg border border-input bg-background pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
      </div>

      <div className="max-h-64 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-6 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando…
          </div>
        ) : tasks.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            {q.trim() ? 'Sin resultados para tu búsqueda.' : 'No hay tareas en este equipo todavía.'}
          </p>
        ) : (
          tasks.map(task => (
            <button
              key={task.id}
              onClick={() => onPick(task)}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-accent/60 transition-colors"
            >
              <span
                className={cn(
                  'mt-1 h-2 w-2 flex-shrink-0 rounded-full',
                  PRIORITY_DOT[task.priority] ?? PRIORITY_DOT.none
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">{task.title}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {task.status && (
                    <span className="truncate">{task.status.name}</span>
                  )}
                  {task.status && task.project_name && <span aria-hidden>·</span>}
                  {task.project_name && <span className="truncate">{task.project_name}</span>}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

'use client'

/**
 * Seccion de dependencias entre tareas dentro del TaskDetailPanel.
 *
 * Modela dos relaciones sobre la tabla `task_dependencies`:
 *  - "Bloqueada por": tareas que deben cerrarse antes que esta.
 *  - "Bloquea a": tareas que esperan a que esta se cierre.
 *
 * Agregar una dependencia busca tareas del mismo proyecto por titulo y llama
 * POST /api/tasks/[taskId]/dependencies; quitar usa DELETE con ?dependsOnId.
 * Autocontenida por taskId. `onOpenTask` (opcional) abre la tarea enlazada.
 */
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Link2, Plus, X, Loader2, Ban } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DepStatus { id: string; name: string; color: string | null; category: string }
interface DepTask { id: string; title: string; status: DepStatus | null }
interface SearchResult { id: string; title: string }

interface DependenciesSectionProps {
  taskId: string
  projectId: string
  onOpenTask?: (taskId: string) => void
  onBlockersChange?: (openCount: number) => void
}

export function DependenciesSection({ taskId, projectId, onOpenTask, onBlockersChange }: DependenciesSectionProps) {
  const [blockers, setBlockers] = useState<DepTask[]>([])
  const [blocking, setBlocking] = useState<DepTask[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/tasks/${taskId}/dependencies`)
      .then(r => (r.ok ? r.json() : { blockers: [], blocking: [] }))
      .then(data => { if (alive) { setBlockers(data.blockers ?? []); setBlocking(data.blocking ?? []) } })
      .catch(() => { if (alive) toast.error('Error al cargar dependencias') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [taskId])

  useEffect(() => {
    if (!adding) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(() => {
      setSearching(true)
      fetch(`/api/projects/${projectId}/tasks/search?q=${encodeURIComponent(q)}`)
        .then(r => (r.ok ? r.json() : { tasks: [] }))
        .then(data => setResults((data.tasks ?? []).filter((t: SearchResult) => t.id !== taskId)))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, adding, projectId, taskId])

  async function handleAdd(dependsOnId: string) {
    // Evitar duplicar lo que ya es blocker
    if (blockers.some(b => b.id === dependsOnId)) { setAdding(false); setQuery(''); return }
    try {
      const res = await fetch(`/api/tasks/${taskId}/dependencies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dependsOnId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? '')
      }
      const created: DepTask = await res.json()
      setBlockers(prev => [...prev, created])
      setAdding(false)
      setQuery('')
      setResults([])
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Error al agregar dependencia')
    }
  }

  async function handleRemove(dependsOnId: string) {
    const before = blockers
    setBlockers(prev => prev.filter(b => b.id !== dependsOnId))
    try {
      const res = await fetch(`/api/tasks/${taskId}/dependencies?dependsOnId=${dependsOnId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      setBlockers(before)
      toast.error('Error al quitar dependencia')
    }
  }

  const openBlockers = blockers.filter(b => b.status?.category !== 'done').length

  useEffect(() => { onBlockersChange?.(openBlockers) }, [openBlockers, onBlockersChange])

  if (loading) {
    return (
      <section>
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2.5">
          <Link2 className="w-3.5 h-3.5" /> Dependencias
        </p>
        <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 text-muted-foreground animate-spin" /></div>
      </section>
    )
  }

  if (blockers.length === 0 && blocking.length === 0 && !adding) {
    return (
      <section>
        <div className="flex items-center justify-between mb-2.5">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
            <Link2 className="w-3.5 h-3.5" /> Dependencias
          </p>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
          >
            <Plus className="w-3 h-3" /> Agregar
          </button>
        </div>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <Link2 className="w-3.5 h-3.5" />
          Dependencias
          {openBlockers > 0 && (
            <span className="ml-0.5 inline-flex items-center gap-1 normal-case tracking-normal text-amber-600 dark:text-amber-500">
              <Ban className="w-3 h-3" /> bloqueada por {openBlockers}
            </span>
          )}
        </p>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-primary transition-colors"
          >
            <Plus className="w-3 h-3" /> Agregar
          </button>
        )}
      </div>

      {blockers.length > 0 && (
        <div className="mb-2">
          <p className="text-[11px] text-muted-foreground/70 mb-1">Bloqueada por</p>
          <div className="space-y-0.5">
            {blockers.map(b => (
              <DepRow key={b.id} task={b} onOpenTask={onOpenTask} onRemove={() => handleRemove(b.id)} />
            ))}
          </div>
        </div>
      )}

      {blocking.length > 0 && (
        <div className="mb-2">
          <p className="text-[11px] text-muted-foreground/70 mb-1">Bloquea a</p>
          <div className="space-y-0.5">
            {blocking.map(b => (
              <DepRow key={b.id} task={b} onOpenTask={onOpenTask} />
            ))}
          </div>
        </div>
      )}

      {adding && (
        <div className="mt-1.5 relative">
          <div className="flex items-center gap-2 px-1.5 py-1 rounded border border-border">
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar tarea que debe cerrarse antes..."
              autoFocus
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60"
            />
            {searching
              ? <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />
              : <button onClick={() => { setAdding(false); setQuery(''); setResults([]) }} aria-label="Cancelar" className="text-muted-foreground hover:text-foreground">
                  <X className="w-3.5 h-3.5" />
                </button>}
          </div>
          {results.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 max-h-48 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
              {results.map(r => (
                <button
                  key={r.id}
                  onClick={() => handleAdd(r.id)}
                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60 truncate"
                >
                  {r.title}
                </button>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="px-1.5 py-1 text-[11px] text-muted-foreground/70">Sin coincidencias</p>
          )}
        </div>
      )}
    </section>
  )
}

// ── Fila de dependencia ───────────────────────────────────────────────────────
function DepRow({
  task, onOpenTask, onRemove,
}: {
  task: DepTask
  onOpenTask?: (taskId: string) => void
  onRemove?: () => void
}) {
  const isDone = task.status?.category === 'done'
  return (
    <div className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/40 transition-colors">
      <span
        className="w-2 h-2 rounded-full flex-shrink-0"
        style={{ backgroundColor: task.status?.color ?? '#94a3b8' }}
        title={task.status?.name ?? 'Sin estado'}
      />
      <button
        onClick={() => onOpenTask?.(task.id)}
        disabled={!onOpenTask}
        className={cn(
          'flex-1 text-sm text-left truncate',
          isDone ? 'line-through text-muted-foreground' : 'text-foreground',
          onOpenTask ? 'hover:text-primary transition-colors cursor-pointer' : 'cursor-default',
        )}
        title={onOpenTask ? 'Abrir tarea' : undefined}
      >
        {task.title}
      </button>
      {onRemove && (
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-all flex-shrink-0"
          aria-label="Quitar dependencia"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

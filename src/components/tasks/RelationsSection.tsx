'use client'

/**
 * Seccion de relaciones (no bloqueantes) entre tareas dentro del TaskDetailPanel.
 * Paridad Jira/ClickUp: "Relacionada con", "Duplica a", "Duplicada por".
 *
 * El bloqueo (bloquea / bloqueada por) vive en DependenciesSection; aqui van las
 * relaciones no bloqueantes. Agregar busca tareas del mismo proyecto por titulo y
 * llama POST /api/tasks/[taskId]/relations; quitar usa DELETE con ?relationId.
 * Autocontenida por taskId. `onOpenTask` (opcional) abre la tarea enlazada.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { GitMerge, Plus, X, Loader2, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

interface RelStatus { id: string; name: string; color: string | null; category: string }
interface RelTask { id: string; title: string; status: RelStatus | null }
interface Relation { id: string; type: string; task: RelTask }
interface SearchResult { id: string; title: string }

const TYPE_LABELS: Record<string, string> = {
  relates_to: 'Relacionada con',
  duplicates: 'Duplica a',
  duplicated_by: 'Duplicada por',
}
// tipos que el usuario puede crear (duplicated_by se normaliza en el server)
const ADD_TYPES: { value: string; label: string }[] = [
  { value: 'relates_to', label: 'Relacionada con' },
  { value: 'duplicates', label: 'Duplica a' },
  { value: 'duplicated_by', label: 'Duplicada por' },
]

interface RelationsSectionProps {
  taskId: string
  projectId: string
  onOpenTask?: (taskId: string) => void
}

export function RelationsSection({ taskId, projectId, onOpenTask }: RelationsSectionProps) {
  const [relations, setRelations] = useState<Relation[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [addType, setAddType] = useState('relates_to')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadRelations = useCallback(async () => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/relations`)
      const data = res.ok ? await res.json() : { relations: [] }
      setRelations(data.relations ?? [])
    } catch {
      toast.error('Error al cargar relaciones')
    }
  }, [taskId])

  // Carga inicial.
  useEffect(() => {
    let alive = true
    setLoading(true)
    loadRelations().finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [loadRelations])

  // Realtime: re-carga (con debounce) cuando cambian relaciones donde esta tarea
  // es origen o destino. La API normaliza la direccion; aqui basta re-fetch.
  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { loadRelations() }, 350)
    }
    const ch = supabase
      .channel(`task-relations-${taskId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_relations', filter: `source_task_id=eq.${taskId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_relations', filter: `target_task_id=eq.${taskId}` }, refresh)
      .subscribe()
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch) }
  }, [taskId, loadRelations])

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

  async function handleAdd(target: SearchResult) {
    if (relations.some(r => r.task.id === target.id && r.type === addType)) {
      setAdding(false); setQuery(''); setResults([]); return
    }
    try {
      const res = await fetch(`/api/tasks/${taskId}/relations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_task_id: target.id, type: addType }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? '')
      }
      const { relation } = await res.json()
      setRelations(prev => [...prev, relation])
      setAdding(false); setQuery(''); setResults([])
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Error al agregar la relacion')
    }
  }

  async function handleRemove(relationId: string) {
    const before = relations
    setRelations(prev => prev.filter(r => r.id !== relationId))
    try {
      const res = await fetch(`/api/tasks/${taskId}/relations?relationId=${relationId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      setRelations(before)
      toast.error('Error al quitar la relacion')
    }
  }

  // agrupar por tipo para mostrar con encabezado
  const grouped = relations.reduce<Record<string, Relation[]>>((acc, r) => {
    (acc[r.type] ??= []).push(r)
    return acc
  }, {})
  const orderedTypes = ['relates_to', 'duplicates', 'duplicated_by'].filter(t => grouped[t]?.length)

  if (loading) {
    return (
      <section>
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2.5">
          <GitMerge className="w-3.5 h-3.5" /> Relaciones
        </p>
        <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 text-muted-foreground animate-spin" /></div>
      </section>
    )
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide">
          <GitMerge className="w-3.5 h-3.5" /> Relaciones
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

      {orderedTypes.map(type => (
        <div key={type} className="mb-2">
          <p className="text-[11px] text-muted-foreground/70 mb-1">{TYPE_LABELS[type]}</p>
          <div className="space-y-0.5">
            {grouped[type].map(r => (
              <RelRow key={r.id} task={r.task} onOpenTask={onOpenTask} onRemove={() => handleRemove(r.id)} />
            ))}
          </div>
        </div>
      ))}

      {adding && (
        <div className="mt-1.5 space-y-1.5">
          {/* Selector de tipo de relacion */}
          <div className="relative">
            <select
              value={addType}
              onChange={e => setAddType(e.target.value)}
              className="w-full appearance-none text-sm bg-background border border-border rounded px-2 py-1 pr-7 outline-none focus:border-primary cursor-pointer"
            >
              {ADD_TYPES.map(t => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <div className="relative">
            <div className="flex items-center gap-2 px-1.5 py-1 rounded border border-border">
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar tarea del proyecto..."
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
                    onClick={() => handleAdd(r)}
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
        </div>
      )}

      {orderedTypes.length === 0 && !adding && (
        <p className="text-[11px] text-muted-foreground/60">Sin relaciones.</p>
      )}
    </section>
  )
}

// ── Fila de relacion ──────────────────────────────────────────────────────────
function RelRow({
  task, onOpenTask, onRemove,
}: {
  task: RelTask
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
          aria-label="Quitar relacion"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}

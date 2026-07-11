'use client'

/**
 * Sección de subtareas/checklist dentro del TaskDetailPanel.
 * UX: una sola lista (auto-creada), inline-add con Enter,
 * toggle con click, edit con doble click, delete con hover.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface ChecklistItem {
  id: string
  title: string
  is_checked: boolean
  position: number
  checklist_id: string
}

interface ChecklistSectionProps {
  taskId: string
}

export function ChecklistSection({ taskId }: ChecklistSectionProps) {
  const [items, setItems] = useState<ChecklistItem[]>([])
  const [loading, setLoading] = useState(true)
  const [newTitle, setNewTitle] = useState('')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/checklist-items`)
      .then(r => r.json())
      .then(data => setItems(data.items ?? []))
      .catch(() => toast.error('Error al cargar subtareas'))
      .finally(() => setLoading(false))
  }, [taskId])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newTitle.trim() || adding) return
    setAdding(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/checklist-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() }),
      })
      if (!res.ok) throw new Error()
      const item: ChecklistItem = await res.json()
      setItems(prev => [...prev, item])
      setNewTitle('')
    } catch {
      toast.error('Error al agregar subtarea')
    } finally {
      setAdding(false)
    }
  }

  async function handleToggle(id: string, checked: boolean) {
    // Optimistic update
    setItems(prev => prev.map(i => (i.id === id ? { ...i, is_checked: checked } : i)))
    try {
      const res = await fetch(`/api/tasks/${taskId}/checklist-items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_checked: checked }),
      })
      if (!res.ok) throw new Error()
    } catch {
      // Revert on error
      setItems(prev => prev.map(i => (i.id === id ? { ...i, is_checked: !checked } : i)))
      toast.error('Error al actualizar')
    }
  }

  async function handleDelete(id: string) {
    const before = items
    setItems(prev => prev.filter(i => i.id !== id))
    try {
      const res = await fetch(`/api/tasks/${taskId}/checklist-items/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error()
    } catch {
      setItems(before)
      toast.error('Error al eliminar')
    }
  }

  async function handleRename(id: string, title: string) {
    if (!title.trim()) return
    const before = items
    setItems(prev => prev.map(i => (i.id === id ? { ...i, title: title.trim() } : i)))
    try {
      const res = await fetch(`/api/tasks/${taskId}/checklist-items/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() }),
      })
      if (!res.ok) throw new Error()
    } catch {
      setItems(before)
      toast.error('Error al renombrar')
    }
  }

  const completed = items.filter(i => i.is_checked).length
  const total = items.length
  const progress = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <div>
      <div className="flex items-center justify-between mb-2.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Lista de verificación {total > 0 && <span className="ml-1 normal-case tracking-normal text-muted-foreground/70">({completed}/{total})</span>}
        </p>
        {total > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-20 h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {progress}%
            </span>
          </div>
        )}
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando...</p>
      ) : (
        <div className="space-y-0.5">
          {items.map(item => (
            <ChecklistRow
              key={item.id}
              item={item}
              onToggle={c => handleToggle(item.id, c)}
              onDelete={() => handleDelete(item.id)}
              onRename={t => handleRename(item.id, t)}
            />
          ))}

          <form onSubmit={handleAdd} className="flex items-center gap-2 px-1.5 py-1">
            <span className="w-3.5 h-3.5 rounded-[4px] border border-border flex-shrink-0" />
            <input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="+ Agregar elemento"
              disabled={adding}
              className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
            />
          </form>
        </div>
      )}
    </div>
  )
}

// ── Item row ────────────────────────────────────────────────────────────────
function ChecklistRow({
  item, onToggle, onDelete, onRename,
}: {
  item: ChecklistItem
  onToggle: (checked: boolean) => void
  onDelete: () => void
  onRename: (title: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(item.title)

  function save() {
    setEditing(false)
    if (draft.trim() && draft.trim() !== item.title) onRename(draft.trim())
    else setDraft(item.title)
  }

  return (
    <div className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/40 transition-colors">
      <button
        onClick={() => onToggle(!item.is_checked)}
        className={cn(
          'flex-shrink-0 w-3.5 h-3.5 rounded-[4px] border transition-colors flex items-center justify-center',
          item.is_checked
            ? 'bg-primary border-primary text-primary-foreground'
            : 'border-border hover:border-primary'
        )}
        aria-label={item.is_checked ? 'Marcar pendiente' : 'Marcar completado'}
      >
        {item.is_checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M2 5l2 2 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>

      {editing ? (
        <input
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={e => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') { setEditing(false); setDraft(item.title) }
          }}
          autoFocus
          className="flex-1 text-sm bg-transparent outline-none border-b border-ring"
        />
      ) : (
        <button
          onDoubleClick={() => { setEditing(true); setDraft(item.title) }}
          className={cn(
            'flex-1 text-sm text-left truncate',
            item.is_checked
              ? 'line-through text-muted-foreground'
              : 'text-foreground'
          )}
          title="Doble clic para editar"
        >
          {item.title}
        </button>
      )}

      <button
        onClick={onDelete}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-all"
        aria-label="Eliminar subtarea"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
          <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  )
}

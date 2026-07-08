'use client'

/**
 * Crear tarea inline — fila con input al final de cada grupo de estado.
 */
import { useState, useRef } from 'react'
import { toast } from 'sonner'

interface CreateTaskInlineProps {
  projectId: string
  statusId: string
  onCreated: (task: {
    id: string
    title: string
    priority: string
    due_date: string | null
    sort_order: string
    status: { id: string; name: string; color: string | null; category: string } | null
    assignee: { id: string; display_name: string; avatar_url: string | null } | null
  }) => void
}

export function CreateTaskInline({ projectId, statusId, onCreated }: CreateTaskInlineProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleOpen = () => {
    setIsOpen(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleCreate = async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      setIsOpen(false)
      return
    }

    setIsLoading(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          status_id: statusId,
          title: trimmed,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error al crear la tarea')
      }

      const newTask = await res.json()
      onCreated(newTask)
      setTitle('')
      setIsOpen(false)
      // Abrir de nuevo para crear otra rápidamente si el user quiere
      // (No hacemos auto-open, dejamos que el usuario haga click de nuevo)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear la tarea')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isOpen) {
    return (
      <button
        onClick={handleOpen}
        className="flex items-center gap-1.5 w-full px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/40 group"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="opacity-50 group-hover:opacity-100">
          <path d="M6 2v8M2 6h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Nueva tarea
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded-md bg-muted/30 border border-ring/20">
      <span className="w-4 h-4 rounded-full border-2 border-muted-foreground/30 flex-shrink-0" />
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') handleCreate()
          if (e.key === 'Escape') { setIsOpen(false); setTitle('') }
        }}
        onBlur={() => {
          // Solo cerramos si el campo está vacío. Antes, hacer blur con texto
          // creaba la tarea automáticamente, lo que provocaba tareas accidentales
          // al hacer clic fuera con la intención de cancelar. Ahora la creación
          // es explícita: Enter para crear, Escape para descartar.
          if (!isLoading && !title.trim()) setIsOpen(false)
        }}
        placeholder="Nombre de la tarea..."
        disabled={isLoading}
        className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/50 disabled:opacity-50"
      />
      {isLoading && (
        <span className="w-3 h-3 border border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin flex-shrink-0" />
      )}
    </div>
  )
}

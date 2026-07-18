'use client'

/**
 * Modal global "Nueva tarea" (R4-B). Se abre desde el botón del Sidebar o con
 * el atajo de teclado C desde cualquier pantalla del workspace. Sigue el
 * patrón modal de la casa (ConfirmDialog): overlay con blur + dialog centrado
 * con shadow-overlay, Escape y click-outside para cerrar.
 *
 * Crea vía POST /api/tasks (solo requiere project_id y title; el servidor
 * resuelve el status inicial y el sort_order). El último proyecto usado se
 * recuerda en localStorage para que crear una tarea sea un solo Enter.
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Plus, ChevronDown, Loader2 } from 'lucide-react'
import { useNewTask } from '@/stores/new-task'

interface TeamWithProjects {
  id: string
  name: string
  slug: string
  projects: Array<{ id: string; name: string; slug: string; icon: string | null }>
}

interface GlobalNewTaskModalProps {
  teams: TeamWithProjects[]
}

const LAST_PROJECT_KEY = 'wlo-new-task-last-project'

const PRIORITIES: Array<{ value: string; label: string }> = [
  { value: 'none', label: 'Sin prioridad' },
  { value: 'urgent', label: 'Urgente' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Media' },
  { value: 'low', label: 'Baja' },
]

/** true si el evento de teclado ocurre dentro de un campo editable. */
function isEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null
  if (!el) return false
  const tag = el.tagName
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    el.isContentEditable
  )
}

export function GlobalNewTaskModal({ teams }: GlobalNewTaskModalProps) {
  const open = useNewTask(s => s.open)
  const setOpen = useNewTask(s => s.setOpen)
  const router = useRouter()

  const projects = teams.flatMap(t =>
    t.projects.map(p => ({ ...p, teamName: t.name }))
  )

  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [priority, setPriority] = useState('none')
  const [submitting, setSubmitting] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  // Atajo global C: abre el modal desde cualquier pantalla del workspace.
  // Se ignora dentro de inputs/textarea/contenteditable y con modificadores.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'c' && e.key !== 'C') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (isEditableTarget(e)) return
      e.preventDefault()
      setOpen(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [setOpen])

  // Al abrir: resetear, restaurar último proyecto usado y enfocar el título.
  useEffect(() => {
    if (!open) return
    setTitle('')
    setPriority('none')
    let initial = projects[0]?.id ?? ''
    try {
      const last = localStorage.getItem(LAST_PROJECT_KEY)
      if (last && projects.some(p => p.id === last)) initial = last
    } catch {
      // localStorage no disponible: usamos el primero.
    }
    setProjectId(initial)
    const t = setTimeout(() => titleRef.current?.focus(), 0)

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', onKeyDown)
    }
    // projects se deriva de props estables (teams del layout server-side).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, setOpen])

  if (!open) return null

  const canSubmit = title.trim().length > 0 && projectId && !submitting

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          title: title.trim(),
          priority,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error ?? 'Error al crear la tarea')
      }
      try {
        localStorage.setItem(LAST_PROJECT_KEY, projectId)
      } catch {
        // Ignorar si no se puede persistir.
      }
      const project = projects.find(p => p.id === projectId)
      toast.success('Tarea creada', {
        description: project ? `En ${project.name}` : undefined,
      })
      setOpen(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al crear la tarea')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-task-title"
        className="fixed left-1/2 top-1/2 z-[91] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-popover p-5 shadow-overlay animate-in fade-in zoom-in-95 duration-150"
      >
        <h2
          id="new-task-title"
          className="flex items-center gap-2 text-sm font-semibold text-popover-foreground"
        >
          <Plus className="h-4 w-4 text-primary" aria-hidden="true" />
          Nueva tarea
        </h2>

        {projects.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No tienes proyectos todavía. Crea un equipo y un proyecto para
            empezar a gestionar tareas.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="mt-4 space-y-3">
            <input
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Título de la tarea"
              aria-label="Título de la tarea"
              maxLength={500}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />

            <div className="grid grid-cols-2 gap-2">
              <div className="relative">
                <select
                  value={projectId}
                  onChange={e => setProjectId(e.target.value)}
                  aria-label="Proyecto"
                  className="w-full appearance-none rounded-lg border border-input bg-background pl-3 pr-8 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {teams.map(team =>
                    team.projects.length > 0 ? (
                      <optgroup key={team.id} label={team.name}>
                        {team.projects.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : null
                  )}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>

              <div className="relative">
                <select
                  value={priority}
                  onChange={e => setPriority(e.target.value)}
                  aria-label="Prioridad"
                  className="w-full appearance-none rounded-lg border border-input bg-background pl-3 pr-8 py-2 text-xs font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  {PRIORITIES.map(p => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-popover-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                Crear tarea
              </button>
            </div>
          </form>
        )}
      </div>
    </>
  )
}

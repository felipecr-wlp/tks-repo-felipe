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
import { Plus, ChevronDown, Loader2, FolderKanban, LayoutTemplate } from 'lucide-react'
import { cn } from '@/lib/utils'
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

// Plantilla de tarea (contraparte a nivel tarea de las plantillas de proyecto).
// Solo se usan los campos que el modal prellena; el servidor siembra la checklist.
interface TaskTemplate {
  id: string
  name: string
  title: string
  description: string | null
  priority: string
}

const LAST_PROJECT_KEY = 'wlo-new-task-last-project'

// Orden visual de menor a mayor urgencia, con el color del punto alineado a la
// leyenda del tablero (Baja azul, Media ambar, Alta naranja, Urgente rojo).
const PRIORITIES: Array<{ value: string; label: string; dot: string }> = [
  { value: 'none', label: 'Sin prioridad', dot: 'bg-muted-foreground/40' },
  { value: 'low', label: 'Baja', dot: 'bg-sky-500' },
  { value: 'medium', label: 'Media', dot: 'bg-amber-500' },
  { value: 'high', label: 'Alta', dot: 'bg-orange-500' },
  { value: 'urgent', label: 'Urgente', dot: 'bg-red-500' },
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
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('none')
  const [submitting, setSubmitting] = useState(false)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [templateId, setTemplateId] = useState('')
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
    setDescription('')
    setPriority('none')
    setTemplateId('')
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

  // Cargar las plantillas del proyecto seleccionado (propias + de todo el
  // workspace). Se limpia la seleccion al cambiar de proyecto para no arrastrar
  // una plantilla de otro proyecto.
  useEffect(() => {
    if (!open || !projectId) {
      setTemplates([])
      return
    }
    let cancelled = false
    setTemplateId('')
    fetch(`/api/projects/${projectId}/task-templates`)
      .then(r => (r.ok ? r.json() : { templates: [] }))
      .then((data: { templates?: TaskTemplate[] }) => {
        if (!cancelled) setTemplates(data.templates ?? [])
      })
      .catch(() => {
        if (!cancelled) setTemplates([])
      })
    return () => { cancelled = true }
  }, [open, projectId])

  if (!open) return null

  // Aplicar una plantilla: prellena titulo (si esta vacio) y descripcion, fija la
  // prioridad y recuerda el id para que el servidor siembre la checklist. "" limpia.
  const applyTemplate = (id: string) => {
    setTemplateId(id)
    if (!id) return
    const tpl = templates.find(t => t.id === id)
    if (!tpl) return
    if (!title.trim() && tpl.title) setTitle(tpl.title)
    if (tpl.description) setDescription(tpl.description)
    if (tpl.priority) setPriority(tpl.priority)
  }

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
          // Al enviar template_id el servidor siembra la checklist de la plantilla.
          ...(templateId ? { template_id: templateId } : {}),
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
        className="fixed left-1/2 top-1/2 z-[91] w-[92vw] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border border-border bg-popover shadow-overlay animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Encabezado */}
        <div className="flex items-start gap-3 border-b border-border bg-muted/40 px-5 py-4">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Plus className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2
              id="new-task-title"
              className="text-sm font-semibold text-popover-foreground"
            >
              Nueva tarea
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Escribe qué hay que hacer y elige dónde va.
            </p>
          </div>
        </div>

        {projects.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            No tienes proyectos todavía. Crea un equipo y un proyecto para
            empezar a gestionar tareas.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4 px-5 py-4">
            {/* Título */}
            <input
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="¿Qué hay que hacer?"
              aria-label="Título de la tarea"
              maxLength={500}
              className="w-full rounded-lg border border-input bg-background px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:ring-2 focus:ring-ring"
            />

            {/* Proyecto */}
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
                Proyecto
              </label>
              <div className="relative">
                <select
                  value={projectId}
                  onChange={e => setProjectId(e.target.value)}
                  aria-label="Proyecto"
                  className="w-full appearance-none rounded-lg border border-input bg-background pl-3 pr-8 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
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
            </div>

            {/* Plantilla de tarea (solo si el proyecto tiene alguna) */}
            {templates.length > 0 && (
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <LayoutTemplate className="h-3.5 w-3.5" aria-hidden="true" />
                  Plantilla
                </label>
                <div className="relative">
                  <select
                    value={templateId}
                    onChange={e => applyTemplate(e.target.value)}
                    aria-label="Plantilla de tarea"
                    className="w-full appearance-none rounded-lg border border-input bg-background pl-3 pr-8 py-2 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="">Ninguna</option>
                    {templates.map(t => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                </div>
              </div>
            )}

            {/* Vista previa de la descripción que aportará la plantilla. Solo
                lectura: el servidor la siembra al crear (via template_id), asi
                que aqui solo se muestra para que el usuario sepa que trae. */}
            {templateId && description && (
              <div className="rounded-lg border border-border bg-muted/40 px-3.5 py-2.5 text-xs text-muted-foreground">
                <span className="mb-1 block font-medium text-foreground">Descripción de la plantilla</span>
                <p className="line-clamp-4 whitespace-pre-wrap">{description}</p>
              </div>
            )}

            {/* Prioridad como pastillas */}
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Prioridad</span>
              <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Prioridad">
                {PRIORITIES.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    role="radio"
                    aria-checked={priority === p.value}
                    onClick={() => setPriority(p.value)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      priority === p.value
                        ? 'border-primary/40 bg-primary/10 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:bg-muted'
                    )}
                  >
                    <span className={cn('h-2 w-2 rounded-full', p.dot)} aria-hidden="true" />
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Pie */}
            <div className="flex items-center justify-between pt-1">
              <span className="hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex">
                <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">Enter</kbd>
                para crear
              </span>
              <div className="flex gap-2">
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
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                  Crear tarea
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </>
  )
}

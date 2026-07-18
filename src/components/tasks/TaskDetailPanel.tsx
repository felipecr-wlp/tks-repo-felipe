'use client'

/**
 * Panel deslizante de detalle de tarea (rediseño Conv B).
 *
 * Jerarquia nueva: encabezado con proyecto/estado, cuerpo en 2 columnas
 * (contenido | metadatos), transiciones suaves, iconos lucide. Suma adjuntos
 * (drag and drop + signed URL) y @menciones en comentarios y descripcion que
 * notifican al mencionado.
 *
 * NO rompe props ni el guardado existente (superficie viva): mismos props,
 * mismo updateField/PATCH, mismos endpoints de comentarios y checklist.
 *
 * Uso: <TaskDetailPanel taskId={id} onClose={() => setOpen(false)} />
 */
import { useEffect, useState, useRef, useCallback } from 'react'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
import {
  X, Trash2, Loader2, Paperclip, UploadCloud, Download, AtSign,
  Zap, ChevronsUp, ChevronUp, ChevronDown, Minus, ImageIcon, FileText,
  CircleDot, User as UserIcon, Calendar as CalendarIcon, MessageSquare,
  CornerLeftUp, PlayCircle, Clock, Eye, Pencil, Check, Repeat,
  AlertTriangle, CalendarClock,
} from 'lucide-react'
import { cn, getInitials, timeAgo } from '@/lib/utils'
import { RECURRENCE_RULES, RECURRENCE_LABELS } from '@/lib/recurrence'
import { ChecklistSection } from './ChecklistSection'
import { SubtasksSection } from './SubtasksSection'
import { DependenciesSection } from './DependenciesSection'
import { RelationsSection } from './RelationsSection'
import { AssigneesSection } from './AssigneesSection'
import { WatchersSection } from './WatchersSection'
import { CustomFieldsSection } from './CustomFieldsSection'
import { TaskActivitySection } from './TaskActivitySection'
import { TimeTrackingSection } from './TimeTrackingSection'
import { TaskLabels } from './TaskLabels'

// Tiptap pesa ~80KB, lazy-load para no inflar bundle inicial
const RichTextEditor = dynamic(
  () => import('@/components/editor/RichTextEditor').then(m => m.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div className="border border-input rounded-lg bg-background min-h-[80px] px-3 py-2 text-sm text-muted-foreground">
        Cargando editor...
      </div>
    ),
  }
)

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface Status { id: string; name: string; color: string | null; category: string }
interface Member { id: string; display_name: string; avatar_url: string | null }

interface TaskDetail {
  id: string
  title: string
  description: string | null
  priority: string
  due_date: string | null
  start_date: string | null
  estimate_minutes: number | null
  recurrence_rule: string | null
  recurrence_end_date: string | null
  sort_order: string
  project_id: string
  status: Status | null
  assignee: Member | null
  created_by_profile: Member | null
  parent: { id: string; title: string } | null
  created_at: string
  updated_at: string
}

interface Comment {
  id: string
  body: string
  created_at: string
  author: Member | null
}

interface Attachment {
  id: string
  name: string
  url: string | null
  mime_type: string | null
  size: number | null
  uploaded_by: string
  created_at: string
}

interface TaskDetailPanelProps {
  taskId: string
  statuses: Status[]
  members: Member[]
  currentUserId: string
  onClose: () => void
  onUpdated?: (task: TaskDetail) => void
  onDeleted?: (taskId: string) => void
  onOpenTask?: (taskId: string) => void
}

const PRIORITIES: { value: string; label: string; color: string; Icon: typeof Zap }[] = [
  { value: 'urgent', label: 'Urgente',       color: 'text-red-500',           Icon: Zap },
  { value: 'high',   label: 'Alta',          color: 'text-orange-500',        Icon: ChevronsUp },
  { value: 'medium', label: 'Media',         color: 'text-yellow-500',        Icon: ChevronUp },
  { value: 'low',    label: 'Baja',          color: 'text-blue-400',          Icon: ChevronDown },
  { value: 'none',   label: 'Sin prioridad', color: 'text-muted-foreground',  Icon: Minus },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Clasifica el vencimiento relativo a HOY (medianoche local, sin corrimiento por
// zona horaria). Mismo criterio que el tablero y la lista.
function dueBucket(due: string | null | undefined, isDone: boolean): 'overdue' | 'today' | 'future' | null {
  if (!due || isDone) return null
  const d = new Date(String(due).slice(0, 10) + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return null
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(start.getDate() + 1)
  if (d < start) return 'overdue'
  if (d < end) return 'today'
  return 'future'
}

function formatSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let n = bytes
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

// Detecta @menciones en un texto contra la lista de miembros. Devuelve ids de
// los miembros cuyo "@Nombre" aparece en el texto (case-insensitive). Sirve para
// comentarios y descripcion; el server revalida contra membresia real.
function detectMentionIds(text: string, members: Member[]): string[] {
  const lower = text.toLowerCase()
  const ids: string[] = []
  for (const m of members) {
    const name = m.display_name?.toLowerCase().trim()
    if (name && lower.includes('@' + name)) ids.push(m.id)
  }
  return Array.from(new Set(ids))
}

// ─── Componente principal ─────────────────────────────────────────────────────
export function TaskDetailPanel({
  taskId,
  statuses,
  members,
  currentUserId,
  onClose,
  onUpdated,
  onDeleted,
  onOpenTask,
}: TaskDetailPanelProps) {
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [comments, setComments] = useState<Comment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleValue, setTitleValue] = useState('')
  const [submittingComment, setSubmittingComment] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [openBlockers, setOpenBlockers] = useState(0)
  // Bump para recargar el historial de actividad tras guardar o comentar.
  const [activityKey, setActivityKey] = useState(0)
  const titleRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // Trigger entrance animation on mount
  useEffect(() => {
    requestAnimationFrame(() => setMounted(true))
  }, [])

  // Cargar tarea + comentarios
  useEffect(() => {
    async function load() {
      setIsLoading(true)
      try {
        const [taskRes, commentsRes] = await Promise.all([
          fetch(`/api/tasks/${taskId}`),
          fetch(`/api/tasks/${taskId}/comments`),
        ])
        if (taskRes.ok) {
          const data: TaskDetail = await taskRes.json()
          setTask(data)
          setTitleValue(data.title)
        }
        if (commentsRes.ok) {
          const data: Comment[] = await commentsRes.json()
          setComments(data)
        }
      } catch {
        toast.error('Error al cargar la tarea')
      } finally {
        setIsLoading(false)
      }
    }
    load()
  }, [taskId])

  // Cerrar con Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  const updateField = async (patch: Record<string, unknown>) => {
    if (!task) return
    setIsSaving(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? 'Error')
      }
      const updated: TaskDetail & { spawned_task_id?: string | null } = await res.json()
      setTask(updated)
      setTitleValue(updated.title)
      setActivityKey(k => k + 1)
      onUpdated?.(updated)
      if (updated.spawned_task_id) {
        toast.success('Tarea recurrente: se creo la siguiente ocurrencia')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setIsSaving(false)
    }
  }

  // Registra menciones (comentario o descripcion) y notifica al mencionado.
  const registerMentions = useCallback(async (text: string, source: 'comment' | 'description') => {
    const ids = detectMentionIds(text, members)
    if (ids.length === 0) return
    try {
      await fetch(`/api/tasks/${taskId}/mentions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mentioned_ids: ids, source }),
      })
    } catch {
      // No romper el guardado principal si la notificacion falla.
    }
  }, [members, taskId])

  const handleTitleSave = () => {
    setEditingTitle(false)
    if (titleValue.trim() && titleValue.trim() !== task?.title) {
      updateField({ title: titleValue.trim() })
    } else {
      setTitleValue(task?.title ?? '')
    }
  }

  const handleDelete = async () => {
    if (!(await confirmDialog({ message: '¿Eliminar esta tarea? No se puede deshacer.', destructive: true, confirmLabel: 'Eliminar' }))) return
    try {
      const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Error al eliminar')
      toast.success('Tarea eliminada')
      onDeleted?.(taskId)
      onClose()
    } catch {
      toast.error('Error al eliminar la tarea')
    }
  }

  const handleAddComment = async (body: string) => {
    const trimmed = body.trim()
    if (!trimmed) return
    setSubmittingComment(true)
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: trimmed }),
      })
      if (!res.ok) throw new Error('Error al agregar comentario')
      const comment: Comment = await res.json()
      setComments(prev => [...prev, comment])
      setActivityKey(k => k + 1)
      registerMentions(trimmed, 'comment')
    } catch {
      toast.error('Error al agregar el comentario')
      throw new Error('failed')
    } finally {
      setSubmittingComment(false)
    }
  }

  const handleEditComment = async (commentId: string, body: string) => {
    const trimmed = body.trim()
    if (!trimmed) return
    const res = await fetch(`/api/tasks/${taskId}/comments/${commentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: trimmed }),
    })
    if (!res.ok) { toast.error('Error al editar el comentario'); throw new Error('failed') }
    const updated: Comment = await res.json()
    setComments(prev => prev.map(c => c.id === commentId ? updated : c))
  }

  const handleDeleteComment = async (commentId: string) => {
    const prev = comments
    setComments(cs => cs.filter(c => c.id !== commentId)) // optimista
    try {
      const res = await fetch(`/api/tasks/${taskId}/comments/${commentId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
    } catch {
      setComments(prev) // revertir
      toast.error('Error al eliminar el comentario')
    }
  }

  const priorityInfo = PRIORITIES.find(p => p.value === task?.priority) ?? PRIORITIES[4]

  return (
    <>
      {/* Overlay con fade-in */}
      <div
        className={cn(
          'fixed inset-0 bg-black/30 z-40 backdrop-blur-[2px] transition-opacity duration-200',
          mounted ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
        aria-hidden
      />

      {/* Panel con slide-in desde la derecha */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Detalle de la tarea"
        className={cn(
          'fixed right-0 top-0 h-full w-full max-w-3xl bg-background border-l border-border shadow-overlay z-50 flex flex-col overflow-hidden',
          'transition-transform duration-300 ease-panel',
          mounted ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-card/60 backdrop-blur-sm flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {task?.status && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-xs font-medium text-foreground">
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: task.status.color ?? '#94a3b8' }} />
                <span className="truncate max-w-[160px]">{task.status.name}</span>
              </span>
            )}
            {task && (
              <span className={cn('inline-flex items-center gap-1 text-xs font-medium', priorityInfo.color)}>
                <priorityInfo.Icon className="w-3.5 h-3.5" />
                {priorityInfo.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {isSaving && (
              <span className="text-xs text-muted-foreground flex items-center gap-1 mr-1">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Guardando...
              </span>
            )}
            <button
              onClick={handleDelete}
              title="Eliminar tarea"
              aria-label="Eliminar tarea"
              className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              title="Cerrar (Esc)"
              aria-label="Cerrar detalle de la tarea"
              className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Contenido ───────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-6 h-6 text-muted-foreground animate-spin" />
            </div>
          ) : !task ? (
            <div className="p-5 text-center text-muted-foreground text-sm">
              No se pudo cargar la tarea.
            </div>
          ) : (
            <div className="flex flex-col lg:flex-row">
              {/* ── Columna de contenido ─────────────────────── */}
              <div className="flex-1 min-w-0 p-5 lg:p-6 space-y-6 lg:border-r lg:border-border">
                {/* Titulo */}
                <div>
                  {task.parent && (
                    <button
                      onClick={() => onOpenTask?.(task.parent!.id)}
                      disabled={!onOpenTask}
                      className={cn(
                        'flex items-center gap-1.5 text-xs text-muted-foreground mb-1.5 max-w-full',
                        onOpenTask ? 'hover:text-primary transition-colors cursor-pointer' : 'cursor-default'
                      )}
                      title={onOpenTask ? 'Abrir tarea padre' : undefined}
                    >
                      <CornerLeftUp className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="truncate">{task.parent.title}</span>
                    </button>
                  )}
                  {editingTitle ? (
                    <input
                      ref={titleRef}
                      value={titleValue}
                      onChange={e => setTitleValue(e.target.value)}
                      onBlur={handleTitleSave}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleTitleSave()
                        if (e.key === 'Escape') { setEditingTitle(false); setTitleValue(task.title) }
                      }}
                      className="w-full text-2xl font-semibold bg-transparent outline-none border-b-2 border-ring pb-1"
                      autoFocus
                    />
                  ) : (
                    <button
                      onClick={() => { setEditingTitle(true); setTimeout(() => titleRef.current?.focus(), 0) }}
                      className="text-2xl font-semibold text-left w-full hover:text-primary transition-colors leading-snug"
                    >
                      {task.title}
                    </button>
                  )}
                </div>

                {/* Descripcion */}
                <section>
                  <SectionLabel icon={<FileText className="w-3.5 h-3.5" />}>Descripción</SectionLabel>
                  <DescriptionEditor
                    value={task.description ?? ''}
                    onSave={desc => { updateField({ description: desc || null }); if (desc) registerMentions(desc, 'description') }}
                  />
                  <MentionHint members={members} />
                </section>

                {/* Etiquetas */}
                <TaskLabels taskId={taskId} />

                {/* Subtareas reales (tareas hijas) */}
                <SubtasksSection
                  taskId={taskId}
                  projectId={task.project_id}
                  statuses={statuses}
                  onOpenTask={onOpenTask}
                />

                {/* Dependencias entre tareas */}
                <DependenciesSection
                  taskId={taskId}
                  projectId={task.project_id}
                  onOpenTask={onOpenTask}
                  onBlockersChange={setOpenBlockers}
                />

                {/* Relaciones no bloqueantes (relacionada con / duplica a) */}
                <RelationsSection
                  taskId={taskId}
                  projectId={task.project_id}
                  onOpenTask={onOpenTask}
                />

                {/* Tiempo registrado */}
                <TimeTrackingSection taskId={taskId} />

                {/* Checklist ligero */}
                <ChecklistSection taskId={taskId} />

                {/* Adjuntos */}
                <AttachmentsSection taskId={taskId} currentUserId={currentUserId} />

                {/* Comentarios */}
                <section>
                  <SectionLabel icon={<MessageSquare className="w-3.5 h-3.5" />}>
                    Comentarios ({comments.length})
                  </SectionLabel>

                  {comments.length > 0 && (
                    <div className="space-y-3 mb-4">
                      {comments.map(comment => (
                        <CommentItem
                          key={comment.id}
                          comment={comment}
                          currentUserId={currentUserId}
                          onEdit={handleEditComment}
                          onDelete={handleDeleteComment}
                        />
                      ))}
                    </div>
                  )}

                  <CommentComposer
                    members={members}
                    submitting={submittingComment}
                    onSubmit={handleAddComment}
                  />
                </section>

                {/* Historial de actividad (B12) */}
                <TaskActivitySection taskId={taskId} refreshKey={activityKey} />
              </div>

              {/* ── Columna de metadatos ─────────────────────── */}
              <aside className="w-full lg:w-64 flex-shrink-0 p-5 lg:p-6 space-y-4 bg-muted/20">
                <MetaRow icon={<CircleDot className="w-3.5 h-3.5" />} label="Estado">
                  <StatusSelect
                    current={task.status}
                    statuses={statuses}
                    onSelect={id => {
                      const target = statuses.find(s => s.id === id)
                      if (target?.category === 'done' && openBlockers > 0) {
                        toast.warning(`Esta tarea tiene ${openBlockers} dependencia(s) sin cerrar`)
                      }
                      updateField({ status_id: id })
                    }}
                  />
                </MetaRow>

                <MetaRow icon={<priorityInfo.Icon className={cn('w-3.5 h-3.5', priorityInfo.color)} />} label="Prioridad">
                  <PrioritySelect
                    current={task.priority}
                    onSelect={p => updateField({ priority: p })}
                  />
                </MetaRow>

                <MetaRow icon={<UserIcon className="w-3.5 h-3.5" />} label="Asignados">
                  <AssigneesSection taskId={taskId} members={members} />
                </MetaRow>

                <MetaRow icon={<Eye className="w-3.5 h-3.5" />} label="Seguidores">
                  <WatchersSection taskId={taskId} currentUserId={currentUserId} />
                </MetaRow>

                <MetaRow icon={<PlayCircle className="w-3.5 h-3.5" />} label="Inicia el">
                  <input
                    type="date"
                    defaultValue={task.start_date ? task.start_date.slice(0, 10) : ''}
                    onChange={e => updateField({ start_date: e.target.value ? new Date(e.target.value).toISOString() : null })}
                    className="text-sm bg-transparent text-foreground cursor-pointer hover:text-primary transition-colors outline-none w-full"
                  />
                </MetaRow>

                <MetaRow icon={<CalendarIcon className="w-3.5 h-3.5" />} label="Vence el">
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      defaultValue={task.due_date ? task.due_date.slice(0, 10) : ''}
                      onChange={e => updateField({ due_date: e.target.value ? new Date(e.target.value).toISOString() : null })}
                      className="text-sm bg-transparent text-foreground cursor-pointer hover:text-primary transition-colors outline-none flex-1"
                    />
                    {(() => {
                      const bucket = dueBucket(task.due_date, task.status?.category === 'done')
                      if (bucket === 'overdue') return (
                        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive text-[10px] font-medium px-1.5 py-0.5 flex-shrink-0">
                          <AlertTriangle className="w-3 h-3" /> Vencida
                        </span>
                      )
                      if (bucket === 'today') return (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 text-[10px] font-medium px-1.5 py-0.5 flex-shrink-0">
                          <CalendarClock className="w-3 h-3" /> Hoy
                        </span>
                      )
                      return null
                    })()}
                  </div>
                </MetaRow>

                <MetaRow icon={<Clock className="w-3.5 h-3.5" />} label="Estimacion">
                  <EstimateField
                    minutes={task.estimate_minutes}
                    onSave={mins => updateField({ estimate_minutes: mins })}
                  />
                </MetaRow>

                <MetaRow icon={<Repeat className="w-3.5 h-3.5" />} label="Repetir">
                  <select
                    value={task.recurrence_rule ?? ''}
                    onChange={e => updateField({
                      recurrence_rule: e.target.value ? e.target.value : null,
                      // Si se apaga la recurrencia, limpiar tambien la fecha limite
                      ...(e.target.value ? {} : { recurrence_end_date: null }),
                    })}
                    className="text-sm bg-transparent text-foreground cursor-pointer hover:text-primary transition-colors outline-none w-full"
                  >
                    <option value="">No repetir</option>
                    {RECURRENCE_RULES.map(r => (
                      <option key={r} value={r}>{RECURRENCE_LABELS[r]}</option>
                    ))}
                  </select>
                  {task.recurrence_rule && (
                    <div className="mt-1.5">
                      <label className="text-[10px] text-muted-foreground block mb-0.5">Repetir hasta (opcional)</label>
                      <input
                        type="date"
                        defaultValue={task.recurrence_end_date ? task.recurrence_end_date.slice(0, 10) : ''}
                        onChange={e => updateField({ recurrence_end_date: e.target.value ? new Date(e.target.value).toISOString() : null })}
                        className="text-sm bg-transparent text-foreground cursor-pointer hover:text-primary transition-colors outline-none w-full"
                      />
                    </div>
                  )}
                </MetaRow>

                {/* Campos personalizados del proyecto (paridad ClickUp/Jira) */}
                <CustomFieldsSection taskId={taskId} projectId={task.project_id} />

                <div className="text-[11px] text-muted-foreground pt-3 border-t border-border space-y-0.5">
                  <p>Creado {timeAgo(task.created_at)}{task.created_by_profile ? ` por ${task.created_by_profile.display_name}` : ''}</p>
                  <p>Actualizado {timeAgo(task.updated_at)}</p>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────

function SectionLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
      {icon}
      {children}
    </p>
  )
}

function MetaRow({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-1.5">
        {icon}
        {label}
      </p>
      {children}
    </div>
  )
}

// ── Estimacion ────────────────────────────────────────────────────────────────
// Acepta "2h", "90m", "1h30m" o un numero suelto (minutos). Guarda minutos.
function parseEstimate(raw: string): number | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  const hm = s.match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?$/)
  if (hm && (hm[1] || hm[2])) {
    return (parseInt(hm[1] ?? '0', 10) * 60) + parseInt(hm[2] ?? '0', 10)
  }
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

function fmtEstimate(mins: number | null): string {
  if (!mins || mins <= 0) return ''
  const h = Math.floor(mins / 60)
  const m = mins % 60
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`
  return `${m}m`
}

function EstimateField({ minutes, onSave }: { minutes: number | null; onSave: (mins: number | null) => void }) {
  const [value, setValue] = useState(fmtEstimate(minutes))
  useEffect(() => { setValue(fmtEstimate(minutes)) }, [minutes])

  const commit = () => {
    const parsed = parseEstimate(value)
    if (parsed === minutes) { setValue(fmtEstimate(minutes)); return }
    onSave(parsed)
  }

  return (
    <input
      value={value}
      onChange={e => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      placeholder="ej. 2h 30m"
      className="text-sm bg-transparent text-foreground hover:text-primary focus:text-foreground transition-colors outline-none w-full placeholder:text-muted-foreground/60"
    />
  )
}

// ── Adjuntos ──────────────────────────────────────────────────────────────────
function AttachmentsSection({ taskId, currentUserId }: { taskId: string; currentUserId: string }) {
  const [items, setItems] = useState<Attachment[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let alive = true
    fetch(`/api/tasks/${taskId}/attachments`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error('fetch failed')))
      .then((data: Attachment[]) => { if (alive) setItems(data) })
      .catch(() => { if (alive) toast.error('No se pudieron cargar los adjuntos') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [taskId])

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return
    setUploading(true)
    for (const file of list) {
      try {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch(`/api/tasks/${taskId}/attachments`, { method: 'POST', body: fd })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error ?? 'Error al subir')
        setItems(prev => [...prev, data as Attachment])
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Error al subir el archivo')
      }
    }
    setUploading(false)
  }, [taskId])

  const remove = async (id: string) => {
    try {
      const res = await fetch(`/api/tasks/${taskId}/attachments/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? 'Error al borrar')
      }
      setItems(prev => prev.filter(a => a.id !== id))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al borrar')
    }
  }

  return (
    <section>
      <SectionLabel icon={<Paperclip className="w-3.5 h-3.5" />}>
        Adjuntos ({items.length})
      </SectionLabel>

      {/* Zona drag and drop */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={e => { e.preventDefault(); setDragOver(false); uploadFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 px-4 py-5 rounded-lg border border-dashed cursor-pointer transition-colors text-center',
          dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50 hover:bg-muted/40'
        )}
      >
        {uploading ? (
          <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
        ) : (
          <UploadCloud className="w-5 h-5 text-muted-foreground" />
        )}
        <p className="text-xs text-muted-foreground">
          Arrastra archivos aqui o haz clic para subir. Maximo 25MB.
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={e => { if (e.target.files) uploadFiles(e.target.files); e.target.value = '' }}
        />
      </div>

      {/* Lista */}
      {loading ? (
        <div className="mt-3 flex justify-center"><Loader2 className="w-4 h-4 text-muted-foreground animate-spin" /></div>
      ) : items.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {items.map(att => (
            <AttachmentItem key={att.id} att={att} canDelete={att.uploaded_by === currentUserId} onDelete={() => remove(att.id)} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function AttachmentItem({ att, canDelete, onDelete }: { att: Attachment; canDelete: boolean; onDelete: () => void }) {
  const isImage = (att.mime_type ?? '').startsWith('image/') && att.url
  return (
    <li className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-card group">
      <div className="w-9 h-9 rounded-md bg-muted flex items-center justify-center overflow-hidden flex-shrink-0">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={att.url!} alt={att.name} className="w-full h-full object-cover" />
        ) : (att.mime_type ?? '').startsWith('image/') ? (
          <ImageIcon className="w-4 h-4 text-muted-foreground" />
        ) : (
          <FileText className="w-4 h-4 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground truncate">{att.name}</p>
        {att.size ? <p className="text-[11px] text-muted-foreground">{formatSize(att.size)}</p> : null}
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {att.url && (
          <a
            href={att.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Descargar"
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
          </a>
        )}
        {canDelete && (
          <button
            onClick={onDelete}
            title="Borrar adjunto"
            className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </li>
  )
}

// ── Composer de comentario con @menciones ─────────────────────────────────────
function CommentComposer({ members, submitting, onSubmit }: {
  members: Member[]
  submitting: boolean
  onSubmit: (body: string) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const suggestions = mentionQuery !== null
    ? members.filter(m => m.display_name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 6)
    : []

  // Detecta si el cursor esta escribiendo un token @... para el autocompletar.
  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setValue(v)
    const upto = v.slice(0, e.target.selectionStart ?? v.length)
    const match = /(^|\s)@([\w.\-]*)$/.exec(upto)
    setMentionQuery(match ? match[2] : null)
  }

  const pickMention = (m: Member) => {
    const el = taRef.current
    const caret = el?.selectionStart ?? value.length
    const before = value.slice(0, caret).replace(/(^|\s)@([\w.\-]*)$/, `$1@${m.display_name} `)
    const after = value.slice(caret)
    const next = before + after
    setValue(next)
    setMentionQuery(null)
    requestAnimationFrame(() => { el?.focus() })
  }

  const send = async () => {
    if (!value.trim()) return
    try {
      await onSubmit(value)
      setValue('')
      setMentionQuery(null)
    } catch {
      // onSubmit ya notifica el error; conservamos el texto.
    }
  }

  return (
    <div className="flex items-start gap-2 relative">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-primary flex items-center justify-center text-[10px] font-bold text-primary-foreground mt-0.5">
        Yo
      </div>
      <div className="flex-1 relative">
        <textarea
          ref={taRef}
          value={value}
          onChange={onChange}
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
            if (e.key === 'Escape') setMentionQuery(null)
          }}
          placeholder="Escribe un comentario... (@ para mencionar, Ctrl+Enter para enviar)"
          rows={2}
          className="w-full text-sm px-3 py-2 border border-input rounded-lg bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
        />

        {/* Autocompletar de menciones */}
        {mentionQuery !== null && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-raised py-1 max-h-52 overflow-y-auto">
            {suggestions.map(m => (
              <button
                key={m.id}
                onClick={() => pickMention(m)}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors text-left"
              >
                <div className="w-5 h-5 rounded-full overflow-hidden bg-muted flex-shrink-0 flex items-center justify-center text-[9px] font-medium">
                  {m.avatar_url ? (
                    <Image src={m.avatar_url} alt={m.display_name} width={20} height={20} className="object-cover" />
                  ) : getInitials(m.display_name)}
                </div>
                <span className="truncate">{m.display_name}</span>
              </button>
            ))}
          </div>
        )}

        {value.trim() && (
          <button
            onClick={send}
            disabled={submitting}
            className="mt-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {submitting ? 'Enviando...' : 'Comentar'}
          </button>
        )}
      </div>
    </div>
  )
}

function MentionHint({ members }: { members: Member[] }) {
  if (members.length === 0) return null
  return (
    <p className="flex items-center gap-1 text-[11px] text-muted-foreground mt-1.5">
      <AtSign className="w-3 h-3" />
      Escribe @nombre para mencionar y notificar a un companero del proyecto.
    </p>
  )
}

function StatusSelect({ current, statuses, onSelect }: {
  current: Status | null
  statuses: Status[]
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 text-sm hover:text-primary transition-colors"
      >
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: current?.color ?? '#94a3b8' }} />
        <span className="truncate">{current?.name ?? 'Sin estado'}</span>
      </button>
      {open && (
        <div className="absolute top-6 left-0 z-50 bg-popover border border-border rounded-lg shadow-raised py-1 w-44" onMouseLeave={() => setOpen(false)}>
          {statuses.map(s => (
            <button key={s.id} onClick={() => { onSelect(s.id); setOpen(false) }}
              className={cn('flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors', s.id === current?.id ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color ?? '#94a3b8' }} />
              {s.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PrioritySelect({ current, onSelect }: { current: string; onSelect: (p: string) => void }) {
  const [open, setOpen] = useState(false)
  const info = PRIORITIES.find(p => p.value === current) ?? PRIORITIES[4]
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className={cn('flex items-center gap-1.5 text-sm hover:text-primary transition-colors', info.color)}>
        <info.Icon className="w-3.5 h-3.5" />
        <span>{info.label}</span>
      </button>
      {open && (
        <div className="absolute top-6 left-0 z-50 bg-popover border border-border rounded-lg shadow-raised py-1 w-40" onMouseLeave={() => setOpen(false)}>
          {PRIORITIES.map(p => (
            <button key={p.value} onClick={() => { onSelect(p.value); setOpen(false) }}
              className={cn('flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors', p.value === current ? 'font-medium text-foreground' : 'text-muted-foreground')}>
              <p.Icon className={cn('w-3.5 h-3.5', p.color)} />
              {p.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DescriptionEditor({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <RichTextEditor
        value={value}
        autoFocus
        onSave={(html) => {
          setEditing(false)
          if (html !== value) onSave(html)
        }}
      />
    )
  }

  // Vista de solo lectura
  if (value) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="w-full text-left text-sm text-foreground transition-colors px-3 py-2 rounded-lg hover:bg-muted/40 border border-transparent hover:border-border prose prose-sm max-w-none [&_p]:my-1 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_a]:text-primary [&_a]:underline"
        dangerouslySetInnerHTML={{ __html: value }}
        title="Clic para editar"
      />
    )
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="w-full text-left text-sm text-muted-foreground hover:text-foreground transition-colors min-h-[60px] px-3 py-2 rounded-lg hover:bg-muted/40 border border-dashed border-border"
    >
      Haz clic para agregar una descripción...
    </button>
  )
}

function CommentItem({
  comment,
  currentUserId,
  onEdit,
  onDelete,
}: {
  comment: Comment
  currentUserId: string
  onEdit: (commentId: string, body: string) => Promise<void>
  onDelete: (commentId: string) => Promise<void>
}) {
  const isOwn = comment.author?.id === currentUserId
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const saveEdit = async () => {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === comment.body) { setEditing(false); return }
    setSaving(true)
    try {
      await onEdit(comment.id, trimmed)
      setEditing(false)
    } catch {
      // el error ya se notifica arriba
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-start gap-2.5 group/comment">
      <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted overflow-hidden flex items-center justify-center text-[10px] font-medium mt-0.5">
        {comment.author?.avatar_url ? (
          <Image src={comment.author.avatar_url} alt={comment.author.display_name} width={24} height={24} className="object-cover" />
        ) : (
          getInitials(comment.author?.display_name ?? '?')
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-medium text-foreground">{comment.author?.display_name ?? 'Usuario'}</span>
          <span className="text-[11px] text-muted-foreground">{timeAgo(comment.created_at)}</span>
          {isOwn && !editing && (
            <div className="ml-auto flex items-center gap-1 opacity-0 group-hover/comment:opacity-100 transition-opacity">
              <button
                onClick={() => { setDraft(comment.body); setEditing(true) }}
                title="Editar"
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <Pencil className="w-3 h-3" />
              </button>
              {confirming ? (
                <button
                  onClick={() => onDelete(comment.id)}
                  className="text-[11px] text-destructive font-medium px-1"
                >
                  Confirmar
                </button>
              ) : (
                <button
                  onClick={() => { setConfirming(true); setTimeout(() => setConfirming(false), 3000) }}
                  title="Eliminar"
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
        </div>

        {editing ? (
          <div className="mt-1">
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              rows={2}
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEdit() }
                if (e.key === 'Escape') setEditing(false)
              }}
              className="w-full text-sm rounded-md border border-border bg-background px-2 py-1.5 resize-y focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <div className="flex items-center gap-2 mt-1.5">
              <button
                onClick={saveEdit}
                disabled={saving}
                className="flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Guardar
              </button>
              <button
                onClick={() => setEditing(false)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">{comment.body}</p>
        )}
      </div>
    </div>
  )
}

'use client'

/**
 * Barra flotante de acciones masivas.
 *
 * Aparece anclada al fondo cuando hay una o mas tareas seleccionadas en la lista.
 * Ofrece cambiar estado, prioridad o asignado, y eliminar (archivar) en lote via
 * el endpoint /api/projects/[projectId]/tasks/bulk.
 *
 * Acciones extendidas (fijar fecha, agregar a sprint, agregar etiqueta, mover a
 * proyecto) NO tienen soporte en el endpoint bulk, asi que se aplican por-tarea
 * con Promise.all sobre los endpoints existentes:
 *  - fijar fecha  -> PATCH /api/tasks/[id]      (campo due_date)
 *  - a sprint     -> PATCH /api/tasks/[id]      (campo sprint_id)
 *  - etiqueta     -> POST  /api/tasks/[id]/labels
 *  - mover        -> PATCH /api/tasks/[id]      (campo project_id, ver nota)
 * Las tres primeras se apoyan en campos/endpoints ya existentes. "Mover a
 * proyecto" depende de que el PATCH de tarea acepte project_id (hoy el schema
 * strict no lo incluye); se deja cableado por-tarea y se avisa al usuario si el
 * server lo rechaza, sin inventar un endpoint nuevo.
 */
import { useState, useEffect } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
import { promptDialog } from '@/components/PromptDialog'
import {
  ChevronsUp, ChevronUp, Equal, ChevronDown, Minus,
  CircleDot, User, Trash2, X, Loader2, CalendarClock, Tag, Zap, FolderInput,
  type LucideIcon,
} from 'lucide-react'
import { ProjectIcon } from '@/lib/project-icons'
import { cn, getInitials } from '@/lib/utils'

interface Status { id: string; name: string; color: string | null; category: string; position?: number }
interface Member { id: string; display_name: string; avatar_url: string | null }
interface Label { id: string; name: string; color: string }
interface Sprint { id: string; name: string; status: string }
interface SiblingProject { id: string; name: string; icon: string | null }

interface BulkActionBarProps {
  projectId: string
  selectedIds: string[]
  statuses: Status[]
  members: Member[]
  onClear: () => void
  onApplied: () => void
  // Datos opcionales para las acciones extendidas. Si no vienen, esa accion se
  // oculta (degrada de forma segura en vistas que aun no los pasan).
  labels?: Label[]
  sprints?: Sprint[]
  projects?: SiblingProject[]
}

type BulkAction =
  | { type: 'status'; statusId: string }
  | { type: 'priority'; priority: string }
  | { type: 'assignee'; assigneeId: string | null }
  | { type: 'delete' }

const PRIORITIES: { value: string; label: string; Icon: LucideIcon; color: string }[] = [
  { value: 'urgent', label: 'Urgente', Icon: ChevronsUp, color: 'text-red-500' },
  { value: 'high', label: 'Alta', Icon: ChevronUp, color: 'text-orange-500' },
  { value: 'medium', label: 'Media', Icon: Equal, color: 'text-yellow-500' },
  { value: 'low', label: 'Baja', Icon: ChevronDown, color: 'text-blue-400' },
  { value: 'none', label: 'Sin prioridad', Icon: Minus, color: 'text-muted-foreground' },
]

export function BulkActionBar({
  projectId,
  selectedIds,
  statuses,
  members,
  onClear,
  onApplied,
  labels,
  sprints,
  projects,
}: BulkActionBarProps) {
  const [menu, setMenu] = useState<null | 'status' | 'priority' | 'assignee' | 'sprint' | 'label' | 'project'>(null)
  const [busy, setBusy] = useState(false)

  const count = selectedIds.length

  // ── Acciones por-tarea (sin soporte en el endpoint bulk) ──────────────────
  // Aplica el mismo cambio a cada tarea seleccionada en paralelo (Promise.all)
  // usando los endpoints existentes. Reporta cuantas fallaron, si aplica.
  async function applyPerTask(
    label: string,
    fn: (taskId: string) => Promise<Response>,
  ) {
    setMenu(null)
    setBusy(true)
    try {
      const results = await Promise.allSettled(selectedIds.map(fn))
      const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)).length
      const ok = selectedIds.length - failed
      if (ok > 0) toast.success(`${ok} ${ok === 1 ? 'tarea actualizada' : 'tareas actualizadas'} (${label})`)
      if (failed > 0) toast.error(`${failed} ${failed === 1 ? 'tarea fallo' : 'tareas fallaron'}`)
      onApplied()
    } catch {
      toast.error('No se pudo aplicar')
    } finally {
      setBusy(false)
    }
  }

  // Fijar fecha de vencimiento (PATCH due_date, ISO datetime).
  async function setDueDate() {
    const value = await promptDialog({
      title: 'Fijar fecha de vencimiento',
      label: 'Fecha (AAAA-MM-DD), vacio para quitar',
      placeholder: '2026-08-15',
      confirmLabel: 'Aplicar',
    })
    if (value === null) return
    const trimmed = value.trim()
    const dueIso = trimmed ? new Date(trimmed + 'T00:00:00').toISOString() : null
    if (trimmed && Number.isNaN(Date.parse(dueIso as string))) {
      toast.error('Fecha invalida')
      return
    }
    await applyPerTask('fecha', taskId =>
      fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ due_date: dueIso }),
      }),
    )
  }

  // Agregar a sprint (PATCH sprint_id).
  async function addToSprint(sprintId: string | null) {
    await applyPerTask('sprint', taskId =>
      fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sprint_id: sprintId }),
      }),
    )
  }

  // Agregar etiqueta (POST /labels, idempotente en el server).
  async function addLabel(labelId: string) {
    await applyPerTask('etiqueta', taskId =>
      fetch(`/api/tasks/${taskId}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labelId }),
      }),
    )
  }

  // Mover a proyecto (PATCH project_id). Ver nota de cabecera: si el server lo
  // rechaza (schema strict sin project_id), applyPerTask lo reporta como fallo.
  async function moveToProject(targetProjectId: string) {
    if (targetProjectId === projectId) { setMenu(null); return }
    await applyPerTask('proyecto', taskId =>
      fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: targetProjectId }),
      }),
    )
  }

  async function apply(action: BulkAction) {
    setMenu(null)
    setBusy(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/tasks/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIds: selectedIds, action }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? 'Error')
      }
      const data = await res.json() as { affected: number }
      const verb = action.type === 'delete' ? 'eliminadas' : 'actualizadas'
      toast.success(`${data.affected} ${data.affected === 1 ? 'tarea' : 'tareas'} ${verb}`)
      onApplied()
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'No se pudo aplicar')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!(await confirmDialog({ message: `¿Eliminar ${count} ${count === 1 ? 'tarea' : 'tareas'}? Se archivarán.`, destructive: true, confirmLabel: 'Eliminar' }))) return
    await apply({ type: 'delete' })
  }

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40">
      <div className="flex items-center gap-1 rounded-xl border border-border bg-popover shadow-overlay px-2 py-1.5">
        {/* Contador */}
        <span className="flex items-center gap-1.5 px-2 text-xs font-medium text-foreground">
          <span className="flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold">
            {count}
          </span>
          seleccionadas
        </span>

        <span className="w-px h-5 bg-border mx-0.5" />

        {/* Estado */}
        <div className="relative">
          <BarButton
            icon={<CircleDot className="w-3.5 h-3.5" />}
            label="Estado"
            active={menu === 'status'}
            onClick={() => setMenu(menu === 'status' ? null : 'status')}
            disabled={busy}
          />
          {menu === 'status' && (
            <FloatMenu onClose={() => setMenu(null)}>
              {statuses.map(s => (
                <MenuItem key={s.id} onClick={() => apply({ type: 'status', statusId: s.id })}>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: s.color ?? '#94a3b8' }} />
                  {s.name}
                </MenuItem>
              ))}
            </FloatMenu>
          )}
        </div>

        {/* Prioridad */}
        <div className="relative">
          <BarButton
            icon={<ChevronsUp className="w-3.5 h-3.5" />}
            label="Prioridad"
            active={menu === 'priority'}
            onClick={() => setMenu(menu === 'priority' ? null : 'priority')}
            disabled={busy}
          />
          {menu === 'priority' && (
            <FloatMenu onClose={() => setMenu(null)}>
              {PRIORITIES.map(p => (
                <MenuItem key={p.value} onClick={() => apply({ type: 'priority', priority: p.value })}>
                  <p.Icon className={cn('w-4 h-4 flex-shrink-0', p.color)} />
                  {p.label}
                </MenuItem>
              ))}
            </FloatMenu>
          )}
        </div>

        {/* Asignado */}
        <div className="relative">
          <BarButton
            icon={<User className="w-3.5 h-3.5" />}
            label="Asignado"
            active={menu === 'assignee'}
            onClick={() => setMenu(menu === 'assignee' ? null : 'assignee')}
            disabled={busy}
          />
          {menu === 'assignee' && (
            <FloatMenu onClose={() => setMenu(null)}>
              <MenuItem onClick={() => apply({ type: 'assignee', assigneeId: null })}>
                <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <User className="w-3 h-3 text-muted-foreground" />
                </span>
                Sin asignar
              </MenuItem>
              {members.map(m => (
                <MenuItem key={m.id} onClick={() => apply({ type: 'assignee', assigneeId: m.id })}>
                  <span className="w-5 h-5 rounded-full bg-muted overflow-hidden flex items-center justify-center flex-shrink-0">
                    {m.avatar_url ? (
                      <Image src={m.avatar_url} alt={m.display_name} width={20} height={20} className="object-cover" />
                    ) : (
                      <span className="text-[9px] font-medium">{getInitials(m.display_name)}</span>
                    )}
                  </span>
                  <span className="truncate">{m.display_name}</span>
                </MenuItem>
              ))}
            </FloatMenu>
          )}
        </div>

        {/* Fijar fecha */}
        <BarButton
          icon={<CalendarClock className="w-3.5 h-3.5" />}
          label="Fecha"
          onClick={setDueDate}
          disabled={busy}
        />

        {/* Agregar etiqueta */}
        {labels && labels.length > 0 && (
          <div className="relative">
            <BarButton
              icon={<Tag className="w-3.5 h-3.5" />}
              label="Etiqueta"
              active={menu === 'label'}
              onClick={() => setMenu(menu === 'label' ? null : 'label')}
              disabled={busy}
            />
            {menu === 'label' && (
              <FloatMenu onClose={() => setMenu(null)}>
                {labels.map(l => (
                  <MenuItem key={l.id} onClick={() => addLabel(l.id)}>
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: l.color }} />
                    <span className="truncate">{l.name}</span>
                  </MenuItem>
                ))}
              </FloatMenu>
            )}
          </div>
        )}

        {/* Agregar a sprint */}
        {sprints && sprints.length > 0 && (
          <div className="relative">
            <BarButton
              icon={<Zap className="w-3.5 h-3.5" />}
              label="Sprint"
              active={menu === 'sprint'}
              onClick={() => setMenu(menu === 'sprint' ? null : 'sprint')}
              disabled={busy}
            />
            {menu === 'sprint' && (
              <FloatMenu onClose={() => setMenu(null)}>
                <MenuItem onClick={() => addToSprint(null)}>
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0 bg-muted-foreground/40" />
                  Quitar del sprint
                </MenuItem>
                {sprints.map(s => (
                  <MenuItem key={s.id} onClick={() => addToSprint(s.id)}>
                    <Zap className="w-3.5 h-3.5 flex-shrink-0 text-amber-500" />
                    <span className="truncate">{s.name}</span>
                  </MenuItem>
                ))}
              </FloatMenu>
            )}
          </div>
        )}

        {/* Mover a proyecto */}
        {projects && projects.length > 1 && (
          <div className="relative">
            <BarButton
              icon={<FolderInput className="w-3.5 h-3.5" />}
              label="Mover"
              active={menu === 'project'}
              onClick={() => setMenu(menu === 'project' ? null : 'project')}
              disabled={busy}
            />
            {menu === 'project' && (
              <FloatMenu onClose={() => setMenu(null)}>
                {projects.filter(p => p.id !== projectId).map(p => (
                  <MenuItem key={p.id} onClick={() => moveToProject(p.id)}>
                    <ProjectIcon icon={p.icon} size={14} className="text-muted-foreground flex-shrink-0" />
                    <span className="truncate">{p.name}</span>
                  </MenuItem>
                ))}
              </FloatMenu>
            )}
          </div>
        )}

        <span className="w-px h-5 bg-border mx-0.5" />

        {/* Eliminar */}
        <BarButton
          icon={<Trash2 className="w-3.5 h-3.5" />}
          label="Eliminar"
          onClick={handleDelete}
          disabled={busy}
          danger
        />

        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground mx-1" />}

        {/* Cerrar seleccion */}
        <button
          onClick={onClear}
          disabled={busy}
          title="Cancelar seleccion"
          className="ml-0.5 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-50"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

function BarButton({
  icon, label, onClick, active, disabled, danger,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50',
        danger
          ? 'text-muted-foreground hover:text-destructive hover:bg-destructive/10'
          : active
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted',
      )}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

function FloatMenu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  // Escape cierra el menú (el overlay solo cubre click/touch).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-48 max-h-64 overflow-auto rounded-lg border border-border bg-popover shadow-raised py-1">
        {children}
      </div>
    </>
  )
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors text-left"
    >
      {children}
    </button>
  )
}

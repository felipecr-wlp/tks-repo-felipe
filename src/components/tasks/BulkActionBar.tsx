'use client'

/**
 * Barra flotante de acciones masivas.
 *
 * Aparece anclada al fondo cuando hay una o mas tareas seleccionadas en la lista.
 * Ofrece cambiar estado, prioridad o asignado, y eliminar (archivar) en lote.
 * Delega la mutacion al endpoint /api/projects/[projectId]/tasks/bulk y avisa al
 * padre para limpiar la seleccion y refrescar.
 */
import { useState, useEffect } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
import {
  ChevronsUp, ChevronUp, Equal, ChevronDown, Minus,
  CircleDot, User, Trash2, X, Loader2, type LucideIcon,
} from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'

interface Status { id: string; name: string; color: string | null; category: string; position?: number }
interface Member { id: string; display_name: string; avatar_url: string | null }

interface BulkActionBarProps {
  projectId: string
  selectedIds: string[]
  statuses: Status[]
  members: Member[]
  onClear: () => void
  onApplied: () => void
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
}: BulkActionBarProps) {
  const [menu, setMenu] = useState<null | 'status' | 'priority' | 'assignee'>(null)
  const [busy, setBusy] = useState(false)

  const count = selectedIds.length

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
      <div className="flex items-center gap-1 rounded-xl border border-border bg-popover shadow-2xl shadow-black/20 px-2 py-1.5">
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
      <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-50 w-48 max-h-64 overflow-auto rounded-lg border border-border bg-popover shadow-xl py-1">
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

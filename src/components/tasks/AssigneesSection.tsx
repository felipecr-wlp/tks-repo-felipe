'use client'

/**
 * Control de MULTIPLES asignados para el panel de la tarea.
 *
 * Muestra avatares apilados y un menu para agregar/quitar personas. Persiste en
 * la tabla `task_assignees` via /api/tasks/[taskId]/assignees. El endpoint
 * mantiene `tasks.assignee_id` (asignado principal) sincronizado para no romper
 * las vistas que aun leen un solo asignado (tablero, listas, scrum).
 *
 * Autocontenido por taskId. `members` son los candidatos del proyecto.
 */
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { Plus, Check } from 'lucide-react'
import { cn, getInitials } from '@/lib/utils'

interface Member { id: string; display_name: string; avatar_url: string | null }

interface AssigneesSectionProps {
  taskId: string
  members: Member[]
  onChange?: (assignees: Member[]) => void
}

export function AssigneesSection({ taskId, members, onChange }: AssigneesSectionProps) {
  const [assignees, setAssignees] = useState<Member[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`/api/tasks/${taskId}/assignees`)
      .then(r => (r.ok ? r.json() : { assignees: [] }))
      .then(data => { if (alive) setAssignees(data.assignees ?? []) })
      .catch(() => { /* silencioso: no romper el panel */ })
    return () => { alive = false }
  }, [taskId])

  // Cierra el menu con Escape (onMouseLeave solo cubre mouse; el overlay, click/touch).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const assignedIds = new Set(assignees.map(a => a.id))

  async function toggle(m: Member) {
    if (busy) return
    setBusy(true)
    const isAssigned = assignedIds.has(m.id)
    try {
      const res = isAssigned
        ? await fetch(`/api/tasks/${taskId}/assignees?profileId=${m.id}`, { method: 'DELETE' })
        : await fetch(`/api/tasks/${taskId}/assignees`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ profileId: m.id }),
          })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? '')
      }
      const data = await res.json()
      const next: Member[] = data.assignees ?? []
      setAssignees(next)
      onChange?.(next)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Error al actualizar asignados')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        {assignees.length > 0 ? (
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center -space-x-1.5 hover:opacity-80 transition-opacity"
            title="Editar asignados"
          >
            {assignees.slice(0, 4).map(a => (
              <span key={a.id} className="w-5 h-5 rounded-full overflow-hidden bg-muted ring-2 ring-background flex-shrink-0">
                {a.avatar_url ? (
                  <Image src={a.avatar_url} alt={a.display_name} width={20} height={20} className="object-cover" />
                ) : (
                  <span className="flex items-center justify-center w-full h-full text-[8px] font-medium">{getInitials(a.display_name)}</span>
                )}
              </span>
            ))}
            {assignees.length > 4 && (
              <span className="w-5 h-5 rounded-full bg-muted ring-2 ring-background flex items-center justify-center text-[8px] font-medium text-muted-foreground">
                +{assignees.length - 4}
              </span>
            )}
          </button>
        ) : (
          <button onClick={() => setOpen(o => !o)} className="text-sm text-muted-foreground hover:text-primary transition-colors">
            Sin asignar
          </button>
        )}
        <button
          onClick={() => setOpen(o => !o)}
          className="w-4 h-4 rounded-full border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors flex items-center justify-center flex-shrink-0"
          aria-label="Agregar asignado"
        >
          <Plus className="w-2.5 h-2.5" />
        </button>
      </div>

      {open && (
        <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div
          className="absolute top-7 left-0 z-50 bg-popover border border-border rounded-lg shadow-raised py-1 w-52 max-h-64 overflow-y-auto"
          onMouseLeave={() => setOpen(false)}
        >
          {members.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-muted-foreground">Sin miembros</p>
          )}
          {members.map(m => {
            const active = assignedIds.has(m.id)
            return (
              <button
                key={m.id}
                onClick={() => toggle(m)}
                disabled={busy}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 text-xs hover:bg-accent transition-colors disabled:opacity-50',
                  active ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                <span className="w-5 h-5 rounded-full overflow-hidden bg-muted flex-shrink-0">
                  {m.avatar_url ? (
                    <Image src={m.avatar_url} alt={m.display_name} width={20} height={20} className="object-cover" />
                  ) : (
                    <span className="flex items-center justify-center w-full h-full text-[9px] font-medium">{getInitials(m.display_name)}</span>
                  )}
                </span>
                <span className="truncate flex-1 text-left">{m.display_name}</span>
                {active && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
              </button>
            )
          })}
        </div>
        </>
      )}
    </div>
  )
}

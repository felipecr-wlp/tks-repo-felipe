'use client'

/**
 * Selector de RESPONSABLE unico para el panel de la tarea (modelo Jira).
 *
 * Jira nativo: cada issue tiene UN solo Assignee (los observadores y el reporter
 * son campos aparte). Aqui replicamos ese modelo: se elige un unico responsable
 * y se persiste en `tasks.assignee_id` via PATCH /api/tasks/[taskId], que valida
 * membresia del proyecto y dispara las notificaciones de asignacion.
 *
 * `value` es el responsable actual (o null). `members` son los candidatos del
 * proyecto. Click en un miembro lo fija como responsable, click en el activo lo
 * deja sin asignar.
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
  value: Member | null
  onChange?: (assignee: Member | null) => void
}

export function AssigneesSection({ taskId, members, value, onChange }: AssigneesSectionProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  // Cierra el menu con Escape (onMouseLeave solo cubre mouse; el overlay, click/touch).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function select(m: Member) {
    if (busy) return
    setBusy(true)
    // Click en el responsable actual lo deja sin asignar (toggle a null).
    const nextId = value?.id === m.id ? null : m.id
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee_id: nextId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? '')
      }
      const data = await res.json()
      const next: Member | null = data.assignee ?? null
      onChange?.(next)
      setOpen(false)
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Error al actualizar el responsable')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1.5">
        {value ? (
          <button
            onClick={() => setOpen(o => !o)}
            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
            title="Editar responsable"
          >
            <span className="w-5 h-5 rounded-full overflow-hidden bg-muted ring-2 ring-background flex-shrink-0">
              {value.avatar_url ? (
                <Image src={value.avatar_url} alt={value.display_name} width={20} height={20} className="object-cover" />
              ) : (
                <span className="flex items-center justify-center w-full h-full text-[8px] font-medium">{getInitials(value.display_name)}</span>
              )}
            </span>
            <span className="text-sm text-foreground truncate max-w-[10rem]">{value.display_name}</span>
          </button>
        ) : (
          <button onClick={() => setOpen(o => !o)} className="text-sm text-muted-foreground hover:text-primary transition-colors">
            Sin asignar
          </button>
        )}
        <button
          onClick={() => setOpen(o => !o)}
          className="w-4 h-4 rounded-full border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors flex items-center justify-center flex-shrink-0"
          aria-label="Elegir responsable"
        >
          <Plus className="w-2.5 h-2.5" />
        </button>
      </div>

      {open && (
        <>
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
        <div
          className="absolute top-7 left-0 z-50 bg-popover border border-border rounded-lg shadow-raised py-1 w-52 max-h-64 overflow-y-auto"
        >
          {members.length === 0 && (
            <p className="px-3 py-1.5 text-xs text-muted-foreground">Sin miembros</p>
          )}
          {members.map(m => {
            const active = value?.id === m.id
            return (
              <button
                key={m.id}
                onClick={() => select(m)}
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

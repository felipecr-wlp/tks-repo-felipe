'use client'

/**
 * ReminderButton, disparador de "crear recordatorio" desde un mensaje del chat
 * (Circuito 1.C). Aparece al hover del mensaje, junto al de reacciones.
 *
 * Abre un popover con opciones rapidas (en 1h, en 3h, manana 9:00, prox. lunes)
 * y una fecha/hora personalizada, mas un selector de destinatario (uno mismo o
 * un miembro del equipo). Al confirmar hace POST a
 * /api/teams/[teamId]/reminders; el cron `due-reminders` lo entrega al inbox
 * (y opcionalmente por correo) cuando llega la hora.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Clock } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Member {
  id: string
  display_name: string
  avatar_url: string | null
}

interface ReminderButtonProps {
  teamId: string
  messageId: string
  messageBody: string
  members: Member[]
  currentUserId: string
  mine: boolean
  /** Visible por hover del mensaje (mismo patron que el de reacciones). */
  hoverClass: string
}

// Manana a las 9:00 local.
function tomorrow9(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d
}
// Proximo lunes a las 9:00 local.
function nextMonday9(): Date {
  const d = new Date()
  d.setHours(9, 0, 0, 0)
  const day = d.getDay() // 0=dom ... 1=lun
  const delta = ((8 - day) % 7) || 7 // dias hasta el proximo lunes (nunca 0)
  d.setDate(d.getDate() + delta)
  return d
}

export function ReminderButton({
  teamId, messageId, messageBody, members, currentUserId, mine, hoverClass,
}: ReminderButtonProps) {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [target, setTarget] = useState(currentUserId)
  const [custom, setCustom] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  async function create(remindAt: Date) {
    if (saving) return
    if (remindAt.getTime() < Date.now() + 30_000) {
      toast.error('Elige una fecha en el futuro')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/teams/${teamId}/reminders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          remind_at: remindAt.toISOString(),
          message_id: messageId,
          body: messageBody.slice(0, 500),
          ...(target !== currentUserId ? { target_id: target } : {}),
        }),
      })
      if (!res.ok) throw new Error()
      toast.success('Recordatorio programado')
      setOpen(false)
      setCustom('')
      setTarget(currentUserId)
    } catch {
      toast.error('No se pudo crear el recordatorio')
    } finally {
      setSaving(false)
    }
  }

  const quick: { label: string; get: () => Date }[] = [
    { label: 'En 1 hora',       get: () => new Date(Date.now() + 60 * 60 * 1000) },
    { label: 'En 3 horas',      get: () => new Date(Date.now() + 3 * 60 * 60 * 1000) },
    { label: 'Mañana 9:00',     get: tomorrow9 },
    { label: 'Próx. lunes 9:00', get: nextMonday9 },
  ]

  // Otros miembros del equipo (para "recordar a alguien mas").
  const others = members.filter(m => m.id !== currentUserId)

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        title="Crear recordatorio"
        aria-label="Crear recordatorio desde el mensaje"
        className={cn(
          'p-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted transition-all',
          open ? 'opacity-100' : hoverClass
        )}
      >
        <Clock className="w-3.5 h-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={cn(
            'absolute z-50 bottom-full mb-1 w-60 p-2 rounded-xl border border-border bg-popover shadow-raised',
            mine ? 'right-0' : 'left-0'
          )}>
            <p className="px-1 pb-1.5 text-[11px] font-medium text-muted-foreground">Recordarme</p>
            <div className="grid grid-cols-2 gap-1">
              {quick.map(q => (
                <button
                  key={q.label}
                  disabled={saving}
                  onClick={() => create(q.get())}
                  className="px-2 py-1.5 rounded-lg border border-border text-xs text-foreground hover:bg-muted transition-colors disabled:opacity-50"
                >
                  {q.label}
                </button>
              ))}
            </div>

            {/* Destinatario: por defecto uno mismo. */}
            {others.length > 0 && (
              <div className="mt-2">
                <label className="block px-1 pb-1 text-[11px] font-medium text-muted-foreground">Para</label>
                <select
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value={currentUserId}>Solo para mí</option>
                  {others.map(m => (
                    <option key={m.id} value={m.id}>{m.display_name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Fecha y hora personalizada. */}
            <div className="mt-2">
              <label className="block px-1 pb-1 text-[11px] font-medium text-muted-foreground">Otra fecha y hora</label>
              <div className="flex items-center gap-1">
                <input
                  type="datetime-local"
                  value={custom}
                  onChange={e => setCustom(e.target.value)}
                  className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-border bg-background text-xs focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <button
                  disabled={saving || !custom}
                  onClick={() => { if (custom) create(new Date(custom)) }}
                  className="flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40"
                >
                  Listo
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

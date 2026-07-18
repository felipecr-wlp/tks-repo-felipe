'use client'

/**
 * Etiquetas (tags) con color para una tarea.
 *
 * Exporta dos piezas:
 *  - `LabelChips`: presentacional, solo lectura, para filas y tarjetas.
 *  - `TaskLabels`: seccion editable dentro del TaskDetailPanel (adjuntar,
 *    quitar y crear etiquetas nuevas del proyecto).
 *
 * Se apoya en /api/tasks/[taskId]/labels. El componente es autocontenido:
 * carga sus propios datos con el taskId.
 */
import { useEffect, useRef, useState } from 'react'
import { Tag, Plus, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export interface TaskLabel {
  id: string
  name: string
  color: string
}

// Paleta para crear etiquetas nuevas (colores accesibles, sin repetir tono).
const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308',
  '#22c55e', '#10b981', '#06b6d4', '#3b82f6',
  '#6366f1', '#8b5cf6', '#ec4899', '#6b7280',
]

// Texto legible sobre el color de fondo (luminancia simple).
function readableText(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.6 ? '#1f2937' : '#ffffff'
}

// ── Chip solo-lectura (filas / tarjetas) ──────────────────────────────────────
export function LabelChips({ labels, className }: { labels: TaskLabel[]; className?: string }) {
  if (!labels || labels.length === 0) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {labels.map(l => (
        <span
          key={l.id}
          className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none"
          style={{ backgroundColor: l.color, color: readableText(l.color) }}
          title={l.name}
        >
          {l.name}
        </span>
      ))}
    </div>
  )
}

// ── Seccion editable (detalle de tarea) ───────────────────────────────────────
export function TaskLabels({
  taskId,
  onChange,
}: {
  taskId: string
  onChange?: (labels: TaskLabel[]) => void
}) {
  const [attached, setAttached] = useState<TaskLabel[]>([])
  const [available, setAvailable] = useState<TaskLabel[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    fetch(`/api/tasks/${taskId}/labels`)
      .then(r => r.json())
      .then(data => {
        setAttached(data.attached ?? [])
        setAvailable(data.available ?? [])
      })
      .catch(() => toast.error('Error al cargar etiquetas'))
      .finally(() => setLoading(false))
  }, [taskId])

  function emit(next: TaskLabel[]) {
    setAttached(next)
    onChange?.(next)
  }

  async function attach(label: TaskLabel) {
    if (attached.some(l => l.id === label.id)) { setOpen(false); return }
    const before = attached
    emit([...attached, label])
    setOpen(false)
    try {
      const res = await fetch(`/api/tasks/${taskId}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ labelId: label.id }),
      })
      if (!res.ok) throw new Error()
    } catch {
      emit(before)
      toast.error('Error al adjuntar etiqueta')
    }
  }

  async function createAndAttach(name: string, color: string) {
    const clean = name.trim()
    if (!clean) return
    setOpen(false)
    try {
      const res = await fetch(`/api/tasks/${taskId}/labels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: clean, color }),
      })
      if (!res.ok) throw new Error()
      const label: TaskLabel = await res.json()
      setAvailable(prev => prev.some(l => l.id === label.id) ? prev : [...prev, label])
      emit([...attached, label])
    } catch {
      toast.error('Error al crear etiqueta')
    }
  }

  async function detach(labelId: string) {
    const before = attached
    emit(attached.filter(l => l.id !== labelId))
    try {
      const res = await fetch(`/api/tasks/${taskId}/labels?labelId=${labelId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      emit(before)
      toast.error('Error al quitar etiqueta')
    }
  }

  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2 text-muted-foreground">
        <Tag className="w-3.5 h-3.5" aria-hidden />
        <span className="text-xs font-medium uppercase tracking-wide">Etiquetas</span>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Cargando...</p>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {attached.map(l => (
            <span
              key={l.id}
              className="group inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium leading-none"
              style={{ backgroundColor: l.color, color: readableText(l.color) }}
            >
              {l.name}
              <button
                onClick={() => detach(l.id)}
                className="opacity-70 hover:opacity-100 transition-opacity"
                aria-label={`Quitar ${l.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}

          <LabelPicker
            available={available.filter(a => !attached.some(l => l.id === a.id))}
            open={open}
            onOpen={() => setOpen(v => !v)}
            onPick={attach}
            onCreate={createAndAttach}
          />
        </div>
      )}
    </div>
  )
}

// ── Popover para elegir o crear etiqueta ──────────────────────────────────────
function LabelPicker({
  available,
  open,
  onOpen,
  onPick,
  onCreate,
}: {
  available: TaskLabel[]
  open: boolean
  onOpen: () => void
  onPick: (label: TaskLabel) => void
  onCreate: (name: string, color: string) => void
}) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(PALETTE[7])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onOpen()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onOpen])

  const q = name.trim().toLowerCase()
  const filtered = q
    ? available.filter(a => a.name.toLowerCase().includes(q))
    : available
  const exact = available.some(a => a.name.toLowerCase() === q)

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={onOpen}
        className="inline-flex items-center gap-1 rounded border border-dashed border-border px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
      >
        <Plus className="w-3 h-3" />
        Etiqueta
      </button>

      {open && (
        <div className="absolute top-6 left-0 z-50 w-56 rounded-lg border border-border bg-popover shadow-raised p-2">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Buscar o crear..."
            autoFocus
            className="w-full text-xs bg-transparent outline-none border-b border-border pb-1.5 mb-1.5 placeholder:text-muted-foreground/60"
            onKeyDown={e => {
              if (e.key === 'Enter' && q && !exact) onCreate(name, color)
            }}
          />

          {filtered.length > 0 && (
            <div className="max-h-40 overflow-y-auto space-y-0.5 mb-1.5">
              {filtered.map(l => (
                <button
                  key={l.id}
                  onClick={() => onPick(l)}
                  className="flex items-center gap-2 w-full px-1.5 py-1 rounded text-xs hover:bg-accent transition-colors"
                >
                  <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: l.color }} />
                  <span className="truncate text-foreground">{l.name}</span>
                </button>
              ))}
            </div>
          )}

          {q && !exact && (
            <div className="border-t border-border pt-1.5">
              <div className="flex items-center gap-1 mb-1.5">
                {PALETTE.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className="w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: c }}
                    aria-label={`Color ${c}`}
                  >
                    {c === color && <Check className="w-2.5 h-2.5 text-white" />}
                  </button>
                ))}
              </div>
              <button
                onClick={() => onCreate(name, color)}
                className="flex items-center gap-1.5 w-full px-1.5 py-1 rounded text-xs text-foreground hover:bg-accent transition-colors"
              >
                <Plus className="w-3 h-3" />
                Crear
                <span
                  className="ml-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium leading-none"
                  style={{ backgroundColor: color, color: readableText(color) }}
                >
                  {name.trim()}
                </span>
              </button>
            </div>
          )}

          {filtered.length === 0 && !q && (
            <p className="text-[11px] text-muted-foreground px-1.5 py-1">
              Escribe para crear una etiqueta.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

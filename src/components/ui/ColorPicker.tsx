'use client'

/**
 * ColorPicker premium reutilizable (estilo Jira / ClickUp).
 *
 * Paleta curada de swatches vibrantes + entrada hex personalizada. Devuelve
 * siempre un hex normalizado en minusculas (#rrggbb). Pensado para vivir dentro
 * de un popover o inline. Sin dependencias externas: solo Tailwind + lucide.
 */
import { useState, useRef, useEffect } from 'react'
import { Check, Pipette } from 'lucide-react'
import { cn } from '@/lib/utils'

// Paleta curada: 6 columnas x 5 filas de tonos "producto" (no lavados).
export const PRESET_COLORS: string[] = [
  '#6b7280', '#94a3b8', '#64748b', '#78716c', '#a8a29e', '#334155',
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#e11d48',
  '#7c3aed', '#2563eb', '#0891b2', '#059669', '#ca8a04', '#dc2626',
]

const HEX_RE = /^#[0-9a-fA-F]{6}$/

interface ColorPickerProps {
  value: string
  onChange: (hex: string) => void
  className?: string
}

export function ColorPicker({ value, onChange, className }: ColorPickerProps) {
  const [hexInput, setHexInput] = useState(value)
  const nativeRef = useRef<HTMLInputElement>(null)

  // Mantener el input sincronizado cuando el valor cambia desde afuera.
  useEffect(() => { setHexInput(value) }, [value])

  function commitHex(raw: string) {
    let v = raw.trim().toLowerCase()
    if (v && !v.startsWith('#')) v = `#${v}`
    if (HEX_RE.test(v)) onChange(v)
  }

  const normalized = value.toLowerCase()

  return (
    <div className={cn('w-60 p-3 rounded-xl border border-border bg-popover shadow-xl', className)}>
      {/* Rejilla de swatches */}
      <div className="grid grid-cols-6 gap-1.5">
        {PRESET_COLORS.map((c) => {
          const active = c.toLowerCase() === normalized
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c.toLowerCase())}
              className={cn(
                'relative w-7 h-7 rounded-md transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-popover',
                active && 'ring-2 ring-offset-1 ring-offset-popover'
              )}
              style={{ backgroundColor: c, ...(active ? { boxShadow: `0 0 0 2px ${c}` } : {}) }}
              aria-label={c}
            >
              {active && (
                <Check className="w-4 h-4 text-white absolute inset-0 m-auto drop-shadow" strokeWidth={3} />
              )}
            </button>
          )
        })}
      </div>

      {/* Entrada hex + selector nativo */}
      <div className="mt-3 flex items-center gap-2">
        <div
          className="w-8 h-8 rounded-md border border-border flex-shrink-0"
          style={{ backgroundColor: HEX_RE.test(hexInput) ? hexInput : value }}
        />
        <div className="relative flex-1">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground select-none">#</span>
          <input
            value={hexInput.replace(/^#/, '')}
            onChange={(e) => setHexInput(`#${e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)}`)}
            onBlur={() => commitHex(hexInput)}
            onKeyDown={(e) => { if (e.key === 'Enter') commitHex(hexInput) }}
            placeholder="6b7280"
            className="w-full pl-5 pr-2 py-1.5 text-sm rounded-md border border-border bg-background font-mono lowercase focus:outline-none focus:ring-2 focus:ring-ring"
            maxLength={6}
          />
        </div>
        <button
          type="button"
          onClick={() => nativeRef.current?.click()}
          className="w-8 h-8 rounded-md border border-border flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors flex-shrink-0"
          aria-label="Selector de color"
          title="Selector de color"
        >
          <Pipette className="w-4 h-4" />
        </button>
        <input
          ref={nativeRef}
          type="color"
          value={HEX_RE.test(value) ? value : '#6b7280'}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
        />
      </div>
    </div>
  )
}

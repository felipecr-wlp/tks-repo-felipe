'use client'

/**
 * Control segmentado para alternar la densidad de las listas/tablas de tareas.
 * Dos opciones: Cómoda (filas mas altas) y Compacta (mas filas visibles).
 * Lee y escribe el store `useDensity` (persistido en localStorage).
 * Pensado para vivir en la barra de herramientas de las vistas de tareas.
 */
import { useEffect, useState } from 'react'
import { Rows3, Rows4 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDensity, type Density } from '@/stores/useDensity'

const OPTIONS: { value: Density; label: string; Icon: typeof Rows3 }[] = [
  { value: 'comfortable', label: 'Cómoda',   Icon: Rows3 },
  { value: 'compact',     label: 'Compacta', Icon: Rows4 },
]

export function DensityToggle({ className }: { className?: string }) {
  const density = useDensity(s => s.density)
  const setDensity = useDensity(s => s.setDensity)
  // Evita el desajuste de hidratacion: en el primer render (servidor y cliente)
  // se usa el default; tras montar se refleja la preferencia real del store.
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  const active: Density = mounted ? density : 'comfortable'

  return (
    <div
      role="group"
      aria-label="Densidad de la lista"
      className={cn('inline-flex items-center rounded-md border border-border bg-background p-0.5', className)}
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const isActive = active === value
        return (
          <button
            key={value}
            type="button"
            onClick={() => setDensity(value)}
            aria-pressed={isActive}
            title={label}
            className={cn(
              'inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium transition-colors',
              isActive
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        )
      })}
    </div>
  )
}

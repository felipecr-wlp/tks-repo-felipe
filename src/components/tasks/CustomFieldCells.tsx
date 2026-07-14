'use client'

/**
 * Chips compactos de solo-lectura con los valores de campos personalizados de una
 * tarea, para la vista de lista. La edicion vive en el panel de detalle
 * (CustomFieldsSection); aqui solo se muestran para dar contexto de un vistazo.
 *
 * Solo pinta campos con valor no vacio, para no saturar la fila.
 */
import { cn } from '@/lib/utils'

export interface CustomFieldDef {
  id: string
  name: string
  field_type: 'text' | 'number' | 'currency' | 'date' | 'checkbox' | 'url' | 'select' | 'multi_select'
  options: { id: string; label: string; color?: string }[]
  position: number
}

function formatValue(def: CustomFieldDef, value: unknown): { text: string; color?: string } | null {
  if (value === null || value === undefined || value === '') return null

  switch (def.field_type) {
    case 'text':
    case 'url':
      return typeof value === 'string' && value.trim() ? { text: value.trim() } : null
    case 'number':
      return typeof value === 'number' ? { text: String(value) } : null
    case 'currency':
      return typeof value === 'number'
        ? { text: `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
        : null
    case 'date':
      if (typeof value !== 'string') return null
      return { text: new Date(value.slice(0, 10) + 'T00:00:00').toLocaleDateString('es-MX', { month: 'short', day: 'numeric' }) }
    case 'checkbox':
      return value === true ? { text: 'Si' } : null
    case 'select': {
      const opt = def.options.find(o => o.id === value)
      return opt ? { text: opt.label, color: opt.color } : null
    }
    case 'multi_select': {
      if (!Array.isArray(value) || value.length === 0) return null
      const labels = value
        .map(id => def.options.find(o => o.id === id)?.label)
        .filter(Boolean)
      return labels.length ? { text: labels.join(', ') } : null
    }
    default:
      return null
  }
}

export function CustomFieldCells({
  fields,
  values,
}: {
  fields: CustomFieldDef[]
  values: Record<string, unknown> | undefined
}) {
  if (!fields.length || !values) return null

  const chips = fields
    .map(def => ({ def, fmt: formatValue(def, values[def.id]) }))
    .filter(x => x.fmt !== null) as { def: CustomFieldDef; fmt: { text: string; color?: string } }[]

  if (!chips.length) return null

  return (
    <div className="flex-shrink-0 flex items-center gap-1 max-w-[45%] overflow-hidden">
      {chips.map(({ def, fmt }) => (
        <span
          key={def.id}
          title={`${def.name}: ${fmt.text}`}
          className={cn(
            'flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-none max-w-[140px] truncate',
            'bg-muted/60 text-muted-foreground border border-border/60',
          )}
          style={fmt.color ? { backgroundColor: `${fmt.color}1a`, borderColor: `${fmt.color}55`, color: fmt.color } : undefined}
        >
          <span className="truncate">{fmt.text}</span>
        </span>
      ))}
    </div>
  )
}

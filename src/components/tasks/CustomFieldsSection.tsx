'use client'

/**
 * Campos personalizados de una tarea, para el panel de detalle. Paridad
 * ClickUp/Jira.
 *
 * Muestra un input tipado por cada definicion del proyecto (text, number,
 * currency, date, checkbox, url, select, multi_select) con su valor actual, y
 * persiste cada cambio via POST /api/tasks/[taskId]/custom-fields (upsert por
 * field_id). El engrane abre el modal para crear/editar/borrar definiciones a
 * nivel proyecto. Autocontenido por taskId + projectId.
 */
import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Settings2, Loader2, Plus, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ManageCustomFieldsModal } from './ManageCustomFieldsModal'

export interface FieldOption { id: string; label: string; color?: string }
export interface CustomField {
  id: string
  name: string
  field_type: 'text' | 'number' | 'currency' | 'date' | 'checkbox' | 'url' | 'select' | 'multi_select'
  options: FieldOption[]
  position: number
  created_at: string
  value: unknown
}

interface Props {
  taskId: string
  projectId: string
}

/**
 * Guard cliente ligero: valida el valor contra el field_type antes de enviarlo.
 * Espeja la validacion del server (que es la fuente de verdad). null siempre es
 * valido (limpia el campo).
 */
function isClientValueValid(field: CustomField, value: unknown): boolean {
  if (value === null) return true
  switch (field.field_type) {
    case 'number':
    case 'currency':
      return typeof value === 'number' && Number.isFinite(value)
    case 'date':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
    case 'checkbox':
      return typeof value === 'boolean'
    case 'select':
      return typeof value === 'string' && (value === '' || field.options.some(o => o.id === value))
    case 'multi_select': {
      if (!Array.isArray(value)) return false
      const ids = new Set(field.options.map(o => o.id))
      return value.every(v => typeof v === 'string' && ids.has(v))
    }
    case 'url':
      if (typeof value !== 'string') return false
      if (value === '') return true
      if (value.length > 2048) return false
      try {
        const u = new URL(value)
        return u.protocol === 'http:' || u.protocol === 'https:'
      } catch {
        return false
      }
    case 'text':
      return typeof value === 'string' && value.length <= 5000
    default:
      return false
  }
}

export function CustomFieldsSection({ taskId, projectId }: Props) {
  const [fields, setFields] = useState<CustomField[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [managing, setManaging] = useState(false)

  const load = useCallback(async () => {
    setError(false)
    try {
      const res = await fetch(`/api/tasks/${taskId}/custom-fields`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setFields(data.fields ?? [])
    } catch (err) {
      console.error(err)
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [taskId])

  useEffect(() => { load() }, [load])

  const saveValue = useCallback(async (fieldId: string, value: unknown) => {
    // guard cliente: no enviar valores que el server rechazaria por tipo.
    // El server valida de nuevo (fuente de verdad), esto solo evita el viaje.
    const field = fields.find(f => f.id === fieldId)
    if (field && !isClientValueValid(field, value)) {
      toast.error('Valor inválido para el tipo de campo')
      return
    }
    setSavingId(fieldId)
    // optimista
    setFields(prev => prev.map(f => (f.id === fieldId ? { ...f, value } : f)))
    try {
      const res = await fetch(`/api/tasks/${taskId}/custom-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ field_id: fieldId, value }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? '')
      }
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Error al guardar el campo')
      load() // revertir al estado del server
    } finally {
      setSavingId(null)
    }
  }, [taskId, load, fields])

  return (
    <div className="pt-3 border-t border-border">
      <div className="flex items-center justify-between mb-2.5">
        <p className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
          <Settings2 className="w-3.5 h-3.5" />
          Campos personalizados
        </p>
        <button
          onClick={() => setManaging(true)}
          className="text-muted-foreground hover:text-primary transition-colors"
          title="Gestionar campos del proyecto"
        >
          <Settings2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando...
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
          <span>No se pudieron cargar los datos. Intenta de nuevo.</span>
          <button
            onClick={() => load()}
            className="ml-auto underline hover:no-underline text-red-600 dark:text-red-400"
          >
            Reintentar
          </button>
        </div>
      ) : fields.length === 0 ? (
        <button
          onClick={() => setManaging(true)}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> Agregar un campo
        </button>
      ) : (
        <div className="space-y-3">
          {fields.map(f => (
            <div key={f.id}>
              <div className="flex items-center gap-1.5 mb-1">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide truncate">{f.name}</p>
                {savingId === f.id && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
              </div>
              <FieldInput field={f} onSave={v => saveValue(f.id, v)} />
            </div>
          ))}
        </div>
      )}

      {managing && (
        <ManageCustomFieldsModal
          projectId={projectId}
          onClose={() => setManaging(false)}
          onChanged={load}
        />
      )}
    </div>
  )
}

// ─── Input tipado por field_type ──────────────────────────────────────────────
function FieldInput({ field, onSave }: { field: CustomField; onSave: (v: unknown) => void }) {
  const base = 'w-full text-sm bg-background border border-input rounded-md px-2 py-1 outline-none focus:border-primary transition-colors'

  switch (field.field_type) {
    case 'text':
      return (
        <input
          type="text"
          defaultValue={typeof field.value === 'string' ? field.value : ''}
          onBlur={e => { const v = e.target.value.trim(); onSave(v || null) }}
          className={base}
          placeholder="Vacio"
        />
      )
    case 'url':
      return (
        <input
          type="url"
          defaultValue={typeof field.value === 'string' ? field.value : ''}
          onBlur={e => { const v = e.target.value.trim(); onSave(v || null) }}
          className={base}
          placeholder="https://"
        />
      )
    case 'number':
      return (
        <input
          type="number"
          defaultValue={typeof field.value === 'number' ? field.value : ''}
          onBlur={e => { const v = e.target.value; onSave(v === '' ? null : Number(v)) }}
          className={base}
          placeholder="0"
        />
      )
    case 'currency':
      return (
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <input
            type="number"
            step="0.01"
            defaultValue={typeof field.value === 'number' ? field.value : ''}
            onBlur={e => { const v = e.target.value; onSave(v === '' ? null : Number(v)) }}
            className={cn(base, 'pl-5')}
            placeholder="0.00"
          />
        </div>
      )
    case 'date':
      return (
        <input
          type="date"
          defaultValue={typeof field.value === 'string' ? field.value.slice(0, 10) : ''}
          onChange={e => onSave(e.target.value || null)}
          className={cn(base, 'cursor-pointer')}
        />
      )
    case 'checkbox':
      return (
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={field.value === true}
            onChange={e => onSave(e.target.checked)}
            className="w-4 h-4 rounded border-input accent-primary cursor-pointer"
          />
          <span className="text-sm text-muted-foreground">{field.value === true ? 'Si' : 'No'}</span>
        </label>
      )
    case 'select':
      return (
        <select
          value={typeof field.value === 'string' ? field.value : ''}
          onChange={e => onSave(e.target.value || null)}
          className={cn(base, 'cursor-pointer')}
        >
          <option value="">Sin seleccionar</option>
          {field.options.map(o => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      )
    case 'multi_select': {
      const selected: string[] = Array.isArray(field.value) ? (field.value as string[]) : []
      const toggle = (id: string) => {
        const next = selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]
        onSave(next)
      }
      return (
        <div className="flex flex-wrap gap-1.5">
          {field.options.length === 0 && <span className="text-xs text-muted-foreground">Sin opciones</span>}
          {field.options.map(o => {
            const on = selected.includes(o.id)
            return (
              <button
                key={o.id}
                onClick={() => toggle(o.id)}
                className={cn(
                  'px-2 py-0.5 rounded-full text-xs font-medium border transition-colors',
                  on
                    ? 'bg-primary/10 border-primary/30 text-primary'
                    : 'bg-transparent border-border text-muted-foreground hover:border-primary/40',
                )}
                style={on && o.color ? { backgroundColor: `${o.color}22`, borderColor: o.color, color: o.color } : undefined}
              >
                {o.label}
              </button>
            )
          })}
        </div>
      )
    }
    default:
      return null
  }
}

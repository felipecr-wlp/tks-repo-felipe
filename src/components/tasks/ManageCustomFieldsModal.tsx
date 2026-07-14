'use client'

/**
 * Modal para gestionar las definiciones de campos personalizados de un proyecto.
 * Crea, renombra y borra campos (borrar CASCADE elimina sus valores en todas las
 * tareas). Para (multi_)select edita la lista de opciones. Paridad ClickUp/Jira.
 *
 * Habla con /api/projects/[projectId]/custom-fields (GET, POST) y
 * /api/projects/[projectId]/custom-fields/[fieldId] (PATCH, DELETE).
 */
import { useEffect, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { X, Loader2, Plus, Trash2, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CustomField, FieldOption } from './CustomFieldsSection'

const FIELD_TYPES: { value: CustomField['field_type']; label: string }[] = [
  { value: 'text', label: 'Texto' },
  { value: 'number', label: 'Numero' },
  { value: 'currency', label: 'Moneda ($)' },
  { value: 'date', label: 'Fecha' },
  { value: 'checkbox', label: 'Casilla (si/no)' },
  { value: 'url', label: 'URL' },
  { value: 'select', label: 'Seleccion unica' },
  { value: 'multi_select', label: 'Seleccion multiple' },
]

interface Props {
  projectId: string
  onClose: () => void
  onChanged: () => void
}

function makeOptionId(label: string): string {
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `${slug || 'opt'}-${Math.random().toString(36).slice(2, 6)}`
}

export function ManageCustomFieldsModal({ projectId, onClose, onChanged }: Props) {
  const [fields, setFields] = useState<CustomField[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  // form de nuevo campo
  const [name, setName] = useState('')
  const [type, setType] = useState<CustomField['field_type']>('text')
  const [options, setOptions] = useState<FieldOption[]>([])
  const [optLabel, setOptLabel] = useState('')

  const isSelect = type === 'select' || type === 'multi_select'

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/custom-fields`)
      if (res.ok) {
        const data = await res.json()
        setFields(data.fields ?? [])
      }
    } catch {
      /* silencioso */
    } finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function addOption() {
    const label = optLabel.trim()
    if (!label) return
    setOptions(prev => [...prev, { id: makeOptionId(label), label }])
    setOptLabel('')
  }

  async function createField() {
    const trimmed = name.trim()
    if (!trimmed) { toast.error('Ponle un nombre al campo'); return }
    if (isSelect && options.length === 0) { toast.error('Agrega al menos una opcion'); return }
    setBusy(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/custom-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, field_type: type, options: isSelect ? options : undefined }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? '')
      }
      toast.success('Campo creado')
      setName(''); setType('text'); setOptions([]); setOptLabel('')
      await load()
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'Error al crear el campo')
    } finally {
      setBusy(false)
    }
  }

  async function renameField(fieldId: string, newName: string) {
    const trimmed = newName.trim()
    if (!trimmed) return
    setFields(prev => prev.map(f => (f.id === fieldId ? { ...f, name: trimmed } : f)))
    try {
      const res = await fetch(`/api/projects/${projectId}/custom-fields/${fieldId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) throw new Error()
      onChanged()
    } catch {
      toast.error('Error al renombrar')
      load()
    }
  }

  async function deleteField(fieldId: string) {
    if (!confirm('Borrar este campo elimina su valor en TODAS las tareas del proyecto. Continuar?')) return
    setBusy(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/custom-fields/${fieldId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success('Campo borrado')
      setFields(prev => prev.filter(f => f.id !== fieldId))
      onChanged()
    } catch {
      toast.error('Error al borrar el campo')
    } finally {
      setBusy(false)
    }
  }

  const inputBase = 'w-full text-sm bg-background border border-input rounded-md px-2.5 py-1.5 outline-none focus:border-primary transition-colors'

  return (
    <>
      <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[60]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[61] w-[92vw] max-w-lg max-h-[85vh] overflow-auto rounded-xl border border-border bg-popover shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border sticky top-0 bg-popover">
          <h2 className="text-sm font-semibold">Campos personalizados del proyecto</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Lista de campos existentes */}
          <div>
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-2">Campos actuales</p>
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando...
              </div>
            ) : fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">Todavia no hay campos. Crea el primero abajo.</p>
            ) : (
              <div className="space-y-1.5">
                {fields.map(f => (
                  <div key={f.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5">
                    <GripVertical className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <input
                      defaultValue={f.name}
                      onBlur={e => { if (e.target.value.trim() && e.target.value.trim() !== f.name) renameField(f.id, e.target.value) }}
                      className="flex-1 text-sm bg-transparent outline-none focus:text-primary min-w-0"
                    />
                    <span className="text-[10px] uppercase tracking-wide text-muted-foreground flex-shrink-0">
                      {FIELD_TYPES.find(t => t.value === f.field_type)?.label ?? f.field_type}
                    </span>
                    <button
                      onClick={() => deleteField(f.id)}
                      disabled={busy}
                      className="text-muted-foreground hover:text-destructive transition-colors flex-shrink-0 disabled:opacity-50"
                      title="Borrar campo"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Form nuevo campo */}
          <div className="pt-4 border-t border-border space-y-3">
            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Nuevo campo</p>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Nombre del campo"
                className={inputBase}
                maxLength={80}
              />
              <select
                value={type}
                onChange={e => { setType(e.target.value as CustomField['field_type']); setOptions([]) }}
                className={cn(inputBase, 'cursor-pointer w-auto')}
              >
                {FIELD_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>

            {isSelect && (
              <div className="space-y-2 rounded-md bg-muted/30 p-2.5">
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Opciones</p>
                {options.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {options.map(o => (
                      <span key={o.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-primary/10 text-primary border border-primary/30">
                        {o.label}
                        <button onClick={() => setOptions(prev => prev.filter(x => x.id !== o.id))} className="hover:text-destructive">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    value={optLabel}
                    onChange={e => setOptLabel(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addOption() } }}
                    placeholder="Etiqueta de la opcion"
                    className={cn(inputBase, 'flex-1')}
                    maxLength={80}
                  />
                  <button
                    onClick={addOption}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-border hover:border-primary/40 hover:text-primary transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" /> Agregar
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={createField}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              Crear campo
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

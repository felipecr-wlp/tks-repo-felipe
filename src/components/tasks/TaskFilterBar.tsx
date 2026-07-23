'use client'

/**
 * Barra de filtros + vistas guardadas del proyecto.
 *
 * Los filtros (estado, prioridad, asignado) se aplican via searchParams para que
 * el server component vuelva a consultar filtrado (fuente de verdad server-side).
 * Una "vista guardada" es una combinacion nombrada de filtros + tipo de vista,
 * privada por usuario, persistida en /api/projects/[projectId]/saved-views.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { promptDialog } from '@/components/PromptDialog'
import { Filter, Bookmark, BookmarkPlus, X, Trash2, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import ExportButton from '@/components/tasks/ExportButton'
import ImportButton from '@/components/tasks/ImportButton'

interface Status { id: string; name: string; color: string | null; category: string }
interface Member { id: string; display_name: string; avatar_url: string | null }
interface Label { id: string; name: string; color: string }
interface CustomFieldFilterDef {
  id: string
  name: string
  field_type: 'text' | 'number' | 'currency' | 'date' | 'checkbox' | 'url' | 'select' | 'multi_select'
  options: { id: string; label: string; color?: string }[]
}
interface SavedView {
  id: string
  name: string
  filters: {
    view?: string; status?: string; priority?: string; assignee?: string
    label?: string; dueFrom?: string; dueTo?: string; cfField?: string; cfValue?: string
  }
}

type CurrentFilters = {
  status?: string; priority?: string; assignee?: string
  label?: string; dueFrom?: string; dueTo?: string; cfField?: string; cfValue?: string
}

interface TaskFilterBarProps {
  basePath: string
  projectId: string
  currentView: string
  statuses: Status[]
  members: Member[]
  labels?: Label[]
  customFields?: CustomFieldFilterDef[]
  current: CurrentFilters
  savedViews: SavedView[]
}

const PRIORITIES: { value: string; label: string }[] = [
  { value: 'urgent', label: 'Urgente' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Media' },
  { value: 'low', label: 'Baja' },
  { value: 'none', label: 'Ninguna' },
]

export function TaskFilterBar({
  basePath,
  projectId,
  currentView,
  statuses,
  members,
  labels = [],
  customFields = [],
  current,
  savedViews,
}: TaskFilterBarProps) {
  const router = useRouter()
  const [views, setViews] = useState<SavedView[]>(savedViews)
  const [menuOpen, setMenuOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const hasFilters = !!(
    current.status || current.priority || current.assignee ||
    current.label || current.dueFrom || current.dueTo || current.cfField
  )

  const cfDef = customFields.find(f => f.id === current.cfField) ?? null

  // Construye la URL preservando la vista actual y el resto de filtros.
  function buildUrl(patch: Partial<CurrentFilters> & { view?: string }): string {
    const params = new URLSearchParams()
    const view = patch.view ?? currentView
    if (view && view !== 'list') params.set('view', view)
    const get = (k: keyof CurrentFilters) => (k in patch ? patch[k] : current[k])
    const map: [string, keyof CurrentFilters][] = [
      ['status', 'status'], ['priority', 'priority'], ['assignee', 'assignee'],
      ['label', 'label'], ['due_from', 'dueFrom'], ['due_to', 'dueTo'],
      ['cf_field', 'cfField'], ['cf_value', 'cfValue'],
    ]
    for (const [param, key] of map) {
      const v = get(key)
      if (v) params.set(param, v)
    }
    const qs = params.toString()
    return qs ? `${basePath}?${qs}` : basePath
  }

  function setFilter(key: keyof CurrentFilters, value: string) {
    router.push(buildUrl({ [key]: value || undefined }))
  }

  // Al cambiar el campo personalizado, resetea su valor (tipos incompatibles).
  function setCfField(value: string) {
    router.push(buildUrl({ cfField: value || undefined, cfValue: undefined }))
  }

  function clearAll() {
    router.push(buildUrl({
      status: undefined, priority: undefined, assignee: undefined,
      label: undefined, dueFrom: undefined, dueTo: undefined,
      cfField: undefined, cfValue: undefined,
    }))
  }

  async function saveCurrent() {
    const name = await promptDialog({
      title: 'Guardar vista',
      label: 'Nombre de la vista guardada',
      placeholder: 'Ej. Mis pendientes urgentes',
      confirmLabel: 'Guardar',
    })
    if (!name) return
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/saved-views`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          filters: {
            view: currentView,
            status: current.status,
            priority: current.priority,
            assignee: current.assignee,
            label: current.label,
            dueFrom: current.dueFrom,
            dueTo: current.dueTo,
            cfField: current.cfField,
            cfValue: current.cfValue,
          },
        }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error ?? '')
      }
      const created = await res.json() as SavedView
      setViews(prev => [...prev, created])
      toast.success('Vista guardada')
    } catch (e) {
      toast.error(e instanceof Error && e.message ? e.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  function applyView(v: SavedView) {
    setMenuOpen(false)
    router.push(buildUrl({
      view: v.filters.view ?? 'list',
      status: v.filters.status,
      priority: v.filters.priority,
      assignee: v.filters.assignee,
      label: v.filters.label,
      dueFrom: v.filters.dueFrom,
      dueTo: v.filters.dueTo,
      cfField: v.filters.cfField,
      cfValue: v.filters.cfValue,
    }))
  }

  async function deleteView(id: string) {
    try {
      const res = await fetch(`/api/projects/${projectId}/saved-views/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      setViews(prev => prev.filter(v => v.id !== id))
      toast.success('Vista eliminada')
    } catch {
      toast.error('No se pudo eliminar')
    }
  }

  const selectClass =
    'text-xs bg-transparent border border-border rounded px-1.5 py-1 outline-none focus:border-primary text-foreground [&>option]:bg-background'

  return (
    <div className="flex items-center flex-wrap gap-2 px-6 py-2 border-b border-border bg-background/60">
      <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        <Filter className="w-3 h-3" /> Filtros
      </span>

      <select
        value={current.status ?? ''}
        onChange={e => setFilter('status', e.target.value)}
        className={selectClass}
        aria-label="Filtrar por estado"
      >
        <option value="">Estado: todos</option>
        {statuses.map(s => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      <select
        value={current.priority ?? ''}
        onChange={e => setFilter('priority', e.target.value)}
        className={selectClass}
        aria-label="Filtrar por prioridad"
      >
        <option value="">Prioridad: todas</option>
        {PRIORITIES.map(p => (
          <option key={p.value} value={p.value}>{p.label}</option>
        ))}
      </select>

      <select
        value={current.assignee ?? ''}
        onChange={e => setFilter('assignee', e.target.value)}
        className={selectClass}
        aria-label="Filtrar por asignado"
      >
        <option value="">Asignado: todos</option>
        {members.map(m => (
          <option key={m.id} value={m.id}>{m.display_name}</option>
        ))}
      </select>

      {/* Filtro por etiqueta */}
      {labels.length > 0 && (
        <select
          value={current.label ?? ''}
          onChange={e => setFilter('label', e.target.value)}
          className={selectClass}
          aria-label="Filtrar por etiqueta"
        >
          <option value="">Etiqueta: todas</option>
          {labels.map(l => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </select>
      )}

      {/* Filtro por rango de fecha de vencimiento */}
      <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
        Vence
        <input
          type="date"
          value={current.dueFrom ?? ''}
          onChange={e => setFilter('dueFrom', e.target.value)}
          className={selectClass}
          aria-label="Vence desde"
          title="Vence desde"
        />
        a
        <input
          type="date"
          value={current.dueTo ?? ''}
          onChange={e => setFilter('dueTo', e.target.value)}
          className={selectClass}
          aria-label="Vence hasta"
          title="Vence hasta"
        />
      </label>

      {/* Filtro por valor de campo personalizado */}
      {customFields.length > 0 && (
        <>
          <select
            value={current.cfField ?? ''}
            onChange={e => setCfField(e.target.value)}
            className={selectClass}
            aria-label="Filtrar por campo personalizado"
          >
            <option value="">Campo: (ninguno)</option>
            {customFields.map(f => (
              <option key={f.id} value={f.id}>Campo: {f.name}</option>
            ))}
          </select>

          {cfDef && (
            (cfDef.field_type === 'select' || cfDef.field_type === 'multi_select') ? (
              <select
                value={current.cfValue ?? ''}
                onChange={e => setFilter('cfValue', e.target.value)}
                className={selectClass}
                aria-label="Valor del campo"
              >
                <option value="">(cualquiera)</option>
                {cfDef.options.map(o => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            ) : cfDef.field_type === 'checkbox' ? (
              <select
                value={current.cfValue ?? ''}
                onChange={e => setFilter('cfValue', e.target.value)}
                className={selectClass}
                aria-label="Valor del campo"
              >
                <option value="">(cualquiera)</option>
                <option value="true">Si</option>
                <option value="false">No</option>
              </select>
            ) : (
              <select
                value={current.cfValue ?? ''}
                onChange={e => setFilter('cfValue', e.target.value)}
                className={selectClass}
                aria-label="Valor del campo"
              >
                <option value="">(cualquiera)</option>
                <option value="__has__">Con valor</option>
                <option value="__empty__">Sin valor</option>
              </select>
            )
          )}
        </>
      )}

      {hasFilters && (
        <button
          onClick={clearAll}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3 h-3" /> Limpiar
        </button>
      )}

      <div className="ml-auto flex items-center gap-1.5">
        {/* Importar tareas del proyecto desde CSV */}
        <ImportButton
          projectId={projectId}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded text-muted-foreground hover:text-primary hover:bg-muted transition-colors disabled:opacity-50"
        />

        {/* Exportar tareas del proyecto a CSV */}
        <ExportButton
          projectId={projectId}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded text-muted-foreground hover:text-primary hover:bg-muted transition-colors disabled:opacity-50"
        />

        {/* Guardar vista actual */}
        <button
          onClick={saveCurrent}
          disabled={saving}
          className="flex items-center gap-1 text-[11px] px-2 py-1 rounded text-muted-foreground hover:text-primary hover:bg-muted transition-colors disabled:opacity-50"
          title="Guardar la combinacion actual de filtros y vista"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <BookmarkPlus className="w-3 h-3" />}
          Guardar vista
        </button>

        {/* Menu de vistas guardadas */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className={cn(
              'flex items-center gap-1 text-[11px] px-2 py-1 rounded transition-colors',
              menuOpen ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
          >
            <Bookmark className="w-3 h-3" /> Vistas
            {views.length > 0 && <span className="text-muted-foreground/70">({views.length})</span>}
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 mt-1 w-56 max-h-72 overflow-auto rounded-md border border-border bg-background shadow-raised z-30 py-1">
                {views.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-muted-foreground">No hay vistas guardadas todavia.</p>
                ) : (
                  views.map(v => (
                    <div
                      key={v.id}
                      className="group flex items-center gap-2 px-2 py-1.5 hover:bg-muted/60 transition-colors"
                    >
                      <button
                        onClick={() => applyView(v)}
                        className="flex-1 flex items-center gap-1.5 text-left text-xs text-foreground min-w-0"
                      >
                        <Check className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{v.name}</span>
                      </button>
                      <button
                        onClick={() => deleteView(v.id)}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-all flex-shrink-0"
                        title="Eliminar vista"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

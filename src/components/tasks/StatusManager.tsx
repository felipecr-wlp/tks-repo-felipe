'use client'

/**
 * Panel "Personalizar estados" del proyecto (estilo Jira / ClickUp).
 *
 * Permite a los administradores del proyecto: renombrar estados, cambiar su
 * color (via ColorPicker premium), cambiar su categoria (afecta metricas de
 * "hecho"), reordenarlos (subir/bajar), crear nuevos y eliminarlos. Habla con
 * /api/projects/[projectId]/statuses y .../[statusId].
 *
 * El reordenamiento usa botones subir/bajar (no drag) para mantener el codigo
 * simple y accesible; persiste el nuevo orden completo con un PATCH batch.
 */
import { useState, useRef, useEffect } from 'react'
import { toast } from 'sonner'
import {
  Plus, Trash2, ChevronUp, ChevronDown, Loader2, Palette, GripVertical, Check,
} from 'lucide-react'
import { ColorPicker, PRESET_COLORS } from '@/components/ui/ColorPicker'
import { useT } from '@/lib/i18n/LanguageProvider'

interface StatusRow {
  id: string
  name: string
  color: string | null
  category: string
  position: number
}

interface Props {
  projectId: string
  initialStatuses: StatusRow[]
}

const CATEGORY_LABEL_KEY: Record<string, string> = {
  todo: 'status.catTodo',
  in_progress: 'status.catInProgress',
  done: 'status.catDone',
  cancelled: 'status.catCancelled',
}
const CATEGORY_ORDER = ['todo', 'in_progress', 'done', 'cancelled'] as const

export function StatusManager({ projectId, initialStatuses }: Props) {
  const t = useT()
  const [statuses, setStatuses] = useState<StatusRow[]>(
    [...initialStatuses].sort((a, b) => a.position - b.position)
  )
  const [openPicker, setOpenPicker] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<StatusRow | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Cierra el picker al hacer clic afuera.
  const pickerWrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!openPicker) return
    function onDown(e: MouseEvent) {
      if (pickerWrapRef.current && !pickerWrapRef.current.contains(e.target as Node)) {
        setOpenPicker(null)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [openPicker])

  async function patchStatus(id: string, patch: Partial<Pick<StatusRow, 'name' | 'color' | 'category'>>) {
    // Optimista
    const prev = statuses
    setStatuses(s => s.map(st => (st.id === id ? { ...st, ...patch } : st)))
    setBusyId(id)
    try {
      const res = await fetch(`/api/projects/${projectId}/statuses/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        setStatuses(prev)
        const body = await res.json().catch(() => ({}))
        toast.error(body.error ?? t('status.updateFail'))
      }
    } catch {
      setStatuses(prev)
      toast.error(t('status.netUpdateFail'))
    } finally {
      setBusyId(null)
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= statuses.length) return
    const next = [...statuses]
    ;[next[index], next[target]] = [next[target], next[index]]
    const reindexed = next.map((s, i) => ({ ...s, position: i }))
    setStatuses(reindexed)
    setReordering(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/statuses`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order: reindexed.map(s => s.id) }),
      })
      if (!res.ok) toast.error(t('status.reorderFail'))
    } catch {
      toast.error(t('status.netReorderFail'))
    } finally {
      setReordering(false)
    }
  }

  async function createStatus() {
    setCreating(true)
    // Elige un color de la paleta que aun no este muy usado.
    const used = new Set(statuses.map(s => (s.color ?? '').toLowerCase()))
    const color = PRESET_COLORS.find(c => !used.has(c.toLowerCase())) ?? '#6366f1'
    try {
      const res = await fetch(`/api/projects/${projectId}/statuses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: t('status.newStatus'), color, category: 'todo' }),
      })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setStatuses(s => [...s, body as StatusRow])
        toast.success(t('status.created'))
      } else {
        toast.error(body.error ?? t('status.createFail'))
      }
    } catch {
      toast.error(t('status.netCreateFail'))
    } finally {
      setCreating(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/statuses/${pendingDelete.id}`, { method: 'DELETE' })
      const body = await res.json().catch(() => ({}))
      if (res.ok) {
        setStatuses(s => s.filter(st => st.id !== pendingDelete.id))
        toast.success(t('status.deleted'))
        setPendingDelete(null)
      } else {
        toast.error(body.error ?? t('status.deleteFail'))
        setPendingDelete(null)
      }
    } catch {
      toast.error(t('status.netDeleteFail'))
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-6">
      <div className="flex items-start justify-between gap-4 mb-1">
        <div className="flex items-center gap-2">
          <Palette className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">{t('status.title')}</h2>
        </div>
        <button
          type="button"
          onClick={createStatus}
          disabled={creating}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {t('status.newStatus')}
        </button>
      </div>
      <p className="text-sm text-muted-foreground mb-5">
        {t('status.description')}
      </p>

      <div className="space-y-2">
        {statuses.map((s, i) => (
          <div
            key={s.id}
            className="group flex items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2"
          >
            {/* Reordenar */}
            <div className="flex flex-col text-muted-foreground">
              <button
                type="button"
                onClick={() => move(i, -1)}
                disabled={i === 0 || reordering}
                className="hover:text-foreground disabled:opacity-30 transition-colors"
                aria-label={t('status.moveUp')}
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => move(i, 1)}
                disabled={i === statuses.length - 1 || reordering}
                className="hover:text-foreground disabled:opacity-30 transition-colors"
                aria-label={t('status.moveDown')}
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>

            <GripVertical className="w-4 h-4 text-muted-foreground/40 flex-shrink-0" />

            {/* Swatch + picker */}
            <div className="relative flex-shrink-0" ref={openPicker === s.id ? pickerWrapRef : undefined}>
              <button
                type="button"
                onClick={() => setOpenPicker(openPicker === s.id ? null : s.id)}
                className="w-6 h-6 rounded-md border border-border/60 transition-transform hover:scale-110"
                style={{ backgroundColor: s.color ?? '#6b7280' }}
                aria-label={t('status.changeColor')}
              />
              {openPicker === s.id && (
                <div className="absolute z-30 top-8 left-0">
                  <ColorPicker
                    value={s.color ?? '#6b7280'}
                    onChange={(hex) => patchStatus(s.id, { color: hex })}
                  />
                </div>
              )}
            </div>

            {/* Nombre editable */}
            <input
              defaultValue={s.name}
              onBlur={(e) => {
                const v = e.target.value.trim()
                if (v && v !== s.name) patchStatus(s.id, { name: v })
                else e.target.value = s.name
              }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              className="flex-1 min-w-0 bg-transparent px-1.5 py-1 text-sm text-foreground rounded-md hover:bg-muted/50 focus:bg-background focus:outline-none focus:ring-2 focus:ring-ring"
              maxLength={40}
            />

            {/* Categoria */}
            <select
              value={s.category}
              onChange={(e) => patchStatus(s.id, { category: e.target.value })}
              className="text-xs rounded-md border border-border bg-background px-2 py-1.5 text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring flex-shrink-0"
            >
              {CATEGORY_ORDER.map(c => (
                <option key={c} value={c}>{t(CATEGORY_LABEL_KEY[c])}</option>
              ))}
            </select>

            {/* Estado de guardado */}
            <div className="w-4 flex-shrink-0 flex items-center justify-center">
              {busyId === s.id
                ? <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                : <Check className="w-3.5 h-3.5 text-transparent" />}
            </div>

            {/* Eliminar */}
            <button
              type="button"
              onClick={() => setPendingDelete(s)}
              className="p-1 rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all flex-shrink-0"
              aria-label={t('status.deleteAria')}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>

      {/* Modal de confirmacion de borrado */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => { if (!deleting) setPendingDelete(null) }}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-border bg-popover shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center" style={{ backgroundColor: '#ef444422', color: '#ef4444' }}>
                <Trash2 className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-foreground">{t('status.deleteConfirmTitle')}</h3>
                <p className="mt-0.5 text-sm text-muted-foreground leading-snug">
                  <span
                    className="inline-block w-2.5 h-2.5 rounded-full align-middle mr-1"
                    style={{ backgroundColor: pendingDelete.color ?? '#6b7280' }}
                  />
                  {pendingDelete.name}
                </p>
                <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                  {t('status.deleteConfirmDesc')}
                </p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setPendingDelete(null)}
                className="px-3 py-1.5 rounded-md text-sm font-medium text-muted-foreground hover:bg-muted transition-colors disabled:opacity-50"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={confirmDelete}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium text-white transition-colors disabled:opacity-60"
                style={{ backgroundColor: '#ef4444' }}
              >
                {deleting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

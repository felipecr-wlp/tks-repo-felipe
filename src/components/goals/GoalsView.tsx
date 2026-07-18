'use client'

/**
 * Vista de Metas (OKR) del workspace. Muestra objetivos con barra de progreso,
 * estado, responsable y fecha limite. Paridad ClickUp Goals / Jira.
 *
 * Dos modos de progreso por meta:
 *   - manual: el usuario ajusta el valor actual a mano.
 *   - tasks:  el progreso se deriva de las tareas enlazadas (hechas / total).
 *
 * Autocontenida por workspaceId. Todo el CRUD va contra /api/goals y
 * /api/workspaces/[id]/goals. El enlace de tareas reusa /api/search del workspace.
 */
import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
import {
  Target, Plus, X, Loader2, Trash2, Link2, ChevronDown, Calendar, Search, Pencil,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'

interface Member { id: string; display_name: string | null; avatar_url: string | null }
interface Goal {
  id: string
  title: string
  description: string | null
  unit: string
  progress_mode: string
  target_value: number
  current_value: number
  status: string
  due_date: string | null
  owner: Member | null
  created_at: string
  task_count: number
  task_done: number
}
interface LinkedTask {
  linkId: string
  id: string
  title: string
  status: { id: string; name: string; color: string | null; category: string } | null
}
interface SearchTask { id: string; title: string }

const STATUS_META: Record<string, { label: string; dot: string; text: string; bg: string }> = {
  on_track:  { label: 'En curso',  dot: 'bg-emerald-500', text: 'text-emerald-700', bg: 'bg-emerald-50' },
  at_risk:   { label: 'En riesgo', dot: 'bg-amber-500',   text: 'text-amber-700',   bg: 'bg-amber-50' },
  off_track: { label: 'Desviada',  dot: 'bg-red-500',     text: 'text-red-700',     bg: 'bg-red-50' },
  done:      { label: 'Lograda',   dot: 'bg-blue-500',    text: 'text-blue-700',    bg: 'bg-blue-50' },
}
const STATUS_OPTIONS = ['on_track', 'at_risk', 'off_track', 'done']
const UNIT_LABELS: Record<string, string> = {
  percent: 'Porcentaje', number: 'Numero', currency: 'Moneda', tasks: 'Tareas',
}

function progressPct(g: Goal): number {
  if (g.progress_mode === 'tasks') {
    return g.task_count > 0 ? Math.round((g.task_done / g.task_count) * 100) : 0
  }
  if (g.unit === 'percent') return Math.max(0, Math.min(100, Math.round(g.current_value)))
  if (g.target_value > 0) return Math.max(0, Math.min(100, Math.round((g.current_value / g.target_value) * 100)))
  return 0
}

function formatValue(g: Goal): string {
  if (g.progress_mode === 'tasks') return `${g.task_done} / ${g.task_count} tareas`
  if (g.unit === 'percent') return `${Math.round(g.current_value)}%`
  if (g.unit === 'currency') return `$${g.current_value.toLocaleString('es-MX')} / $${g.target_value.toLocaleString('es-MX')}`
  return `${g.current_value} / ${g.target_value}`
}

export function GoalsView({
  workspaceId, workspaceName, members,
}: {
  workspaceId: string
  workspaceName: string
  members: Member[]
}) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [filter, setFilter] = useState<string>('all')

  const loadGoals = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/goals`)
      const data = res.ok ? await res.json() : { goals: [] }
      setGoals(data.goals ?? [])
    } catch {
      toast.error('Error al cargar las metas')
    }
  }, [workspaceId])

  // Carga inicial.
  useEffect(() => {
    let alive = true
    setLoading(true)
    loadGoals().finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [loadGoals])

  // Realtime: re-carga (con debounce) ante cualquier cambio de metas o enlaces.
  // La RLS del rol autenticado filtra que eventos llegan (solo su workspace).
  useEffect(() => {
    const supabase = createClient()
    let timer: ReturnType<typeof setTimeout> | null = null
    const refresh = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { loadGoals() }, 350)
    }
    const ch = supabase
      .channel(`goals-${workspaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'goals', filter: `workspace_id=eq.${workspaceId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'goal_tasks' }, refresh)
      .subscribe()
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch) }
  }, [workspaceId, loadGoals])

  const handleCreated = (g: Goal) => { setGoals(prev => [g, ...prev]); setCreating(false) }
  const handleUpdated = (g: Goal) => { setGoals(prev => prev.map(x => (x.id === g.id ? { ...x, ...g } : x))); setEditingId(null) }
  const handleDeleted = (id: string) => setGoals(prev => prev.filter(x => x.id !== id))

  const activeCount = goals.filter(g => g.status !== 'done').length
  const doneCount = goals.filter(g => g.status === 'done').length

  // Rollup: progreso promedio de las metas NO logradas (o 100 si todas logradas).
  const tracked = goals.filter(g => g.status !== 'done')
  const rollup = goals.length === 0
    ? 0
    : tracked.length === 0
      ? 100
      : Math.round(tracked.reduce((sum, g) => sum + progressPct(g), 0) / tracked.length)

  const FILTERS: Array<{ key: string; label: string }> = [
    { key: 'all', label: 'Todas' },
    { key: 'on_track', label: 'En curso' },
    { key: 'at_risk', label: 'En riesgo' },
    { key: 'off_track', label: 'Desviada' },
    { key: 'done', label: 'Lograda' },
  ]
  const visible = filter === 'all' ? goals : goals.filter(g => g.status === filter)

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <Target className="w-6 h-6 text-primary" /> Metas
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {workspaceName} · {activeCount} activa{activeCount !== 1 ? 's' : ''}
            {doneCount > 0 && <span className="ml-1">· {doneCount} lograda{doneCount !== 1 ? 's' : ''}</span>}
          </p>
        </div>
        {!creating && (
          <button
            onClick={() => { setCreating(true); setEditingId(null) }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" /> Nueva meta
          </button>
        )}
      </div>

      {/* Rollup de progreso global */}
      {goals.length > 0 && (
        <div className="mb-5 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-5">
            <ProgressRing pct={rollup} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Progreso general</span>
                <span className="text-xs text-muted-foreground">
                  {tracked.length > 0 ? `${tracked.length} en seguimiento` : 'Todas logradas'}
                </span>
              </div>
              <div className="h-2.5 rounded-full bg-muted overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-500', rollup >= 100 ? 'bg-emerald-500' : 'bg-gradient-to-r from-primary to-emerald-500')}
                  style={{ width: `${rollup}%` }}
                />
              </div>
              <div className="flex items-center gap-4 mt-3 flex-wrap">
                {STATUS_OPTIONS.map(s => {
                  const n = goals.filter(g => g.status === s).length
                  if (n === 0) return null
                  const sm = STATUS_META[s]
                  return (
                    <span key={s} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={cn('w-2 h-2 rounded-full', sm.dot)} />
                      {n} {sm.label.toLowerCase()}
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filtros por estado */}
      {goals.length > 0 && (
        <div className="flex items-center gap-1.5 mb-4 flex-wrap">
          {FILTERS.map(f => {
            const n = f.key === 'all' ? goals.length : goals.filter(g => g.status === f.key).length
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-full border transition-colors',
                  filter === f.key
                    ? 'border-primary bg-primary/10 text-primary font-medium'
                    : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/60',
                )}
              >
                {f.label} <span className="opacity-60">{n}</span>
              </button>
            )
          })}
        </div>
      )}

      {creating && (
        <GoalForm
          workspaceId={workspaceId}
          members={members}
          onCancel={() => setCreating(false)}
          onSaved={handleCreated}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 text-muted-foreground animate-spin" /></div>
      ) : goals.length === 0 && !creating ? (
        <div className="text-center py-16">
          <Target className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
          <h3 className="text-sm font-medium text-foreground mb-1">Sin metas todavia</h3>
          <p className="text-sm text-muted-foreground">Crea la primera meta para dar seguimiento a tus objetivos.</p>
        </div>
      ) : visible.length === 0 ? (
        <p className="text-center py-12 text-sm text-muted-foreground">Ninguna meta con este estado.</p>
      ) : (
        <div className="space-y-3">
          {visible.map(g => (
            editingId === g.id ? (
              <GoalForm
                key={g.id}
                workspaceId={workspaceId}
                members={members}
                goal={g}
                onCancel={() => setEditingId(null)}
                onSaved={handleUpdated}
              />
            ) : (
              <GoalCard
                key={g.id}
                goal={g}
                workspaceId={workspaceId}
                onEdit={() => { setEditingId(g.id); setCreating(false) }}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            )
          ))}
        </div>
      )}
    </div>
  )
}

// ── Formulario de creacion / edicion ──────────────────────────────────────────
function GoalForm({
  workspaceId, members, goal, onCancel, onSaved,
}: {
  workspaceId: string
  members: Member[]
  goal?: Goal
  onCancel: () => void
  onSaved: (g: Goal) => void
}) {
  const editing = Boolean(goal)
  const [title, setTitle] = useState(goal?.title ?? '')
  const [description, setDescription] = useState(goal?.description ?? '')
  const [mode, setMode] = useState<'manual' | 'tasks'>((goal?.progress_mode as 'manual' | 'tasks') ?? 'manual')
  const [unit, setUnit] = useState(goal && goal.unit !== 'tasks' ? goal.unit : 'percent')
  const [target, setTarget] = useState(goal ? String(goal.target_value) : '100')
  const [current, setCurrent] = useState(goal ? String(goal.current_value) : '0')
  const [ownerId, setOwnerId] = useState(goal?.owner?.id ?? '')
  const [dueDate, setDueDate] = useState(goal?.due_date ?? '')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!title.trim()) { toast.error('La meta necesita un titulo'); return }
    setSaving(true)
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        progress_mode: mode,
        unit: mode === 'tasks' ? 'tasks' : unit,
        target_value: mode === 'tasks' ? 0 : Number(target) || 0,
        owner_id: ownerId || null,
        due_date: dueDate || null,
        ...(editing && mode === 'manual' ? { current_value: Number(current) || 0 } : {}),
      }
      const res = await fetch(
        editing ? `/api/goals/${goal!.id}` : `/api/workspaces/${workspaceId}/goals`,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      )
      if (!res.ok) throw new Error()
      const { goal: saved } = await res.json()
      onSaved(editing ? { ...goal!, ...saved } : saved)
      toast.success(editing ? 'Meta actualizada' : 'Meta creada')
    } catch {
      toast.error(editing ? 'Error al actualizar la meta' : 'Error al crear la meta')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mb-5 rounded-lg border border-border bg-card p-4 space-y-3">
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        placeholder="Titulo de la meta (ej. Cerrar 20 proyectos en Q3)"
        autoFocus
        className="w-full text-sm bg-background border border-border rounded px-2.5 py-1.5 outline-none focus:border-primary"
      />
      <textarea
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder="Descripcion (opcional)"
        rows={2}
        className="w-full text-sm bg-background border border-border rounded px-2.5 py-1.5 outline-none focus:border-primary resize-none"
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Progreso</span>
          <select
            value={mode}
            onChange={e => setMode(e.target.value as 'manual' | 'tasks')}
            className="text-sm bg-background border border-border rounded px-2 py-1.5 outline-none focus:border-primary"
          >
            <option value="manual">Manual</option>
            <option value="tasks">Por tareas enlazadas</option>
          </select>
        </label>
        {mode === 'manual' ? (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Unidad</span>
            <select
              value={unit}
              onChange={e => setUnit(e.target.value)}
              className="text-sm bg-background border border-border rounded px-2 py-1.5 outline-none focus:border-primary"
            >
              {Object.entries(UNIT_LABELS).filter(([k]) => k !== 'tasks').map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
        ) : <div />}
        {mode === 'manual' && unit !== 'percent' && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Objetivo</span>
            <input
              type="number"
              value={target}
              onChange={e => setTarget(e.target.value)}
              className="text-sm bg-background border border-border rounded px-2 py-1.5 outline-none focus:border-primary"
            />
          </label>
        )}
        {editing && mode === 'manual' && (
          <label className="flex flex-col gap-1">
            <span className="text-[11px] text-muted-foreground">Valor actual</span>
            <input
              type="number"
              value={current}
              onChange={e => setCurrent(e.target.value)}
              className="text-sm bg-background border border-border rounded px-2 py-1.5 outline-none focus:border-primary"
            />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Responsable</span>
          <select
            value={ownerId}
            onChange={e => setOwnerId(e.target.value)}
            className="text-sm bg-background border border-border rounded px-2 py-1.5 outline-none focus:border-primary"
          >
            <option value="">Sin responsable</option>
            {members.map(m => (
              <option key={m.id} value={m.id}>{m.display_name ?? 'Sin nombre'}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-muted-foreground">Fecha limite</span>
          <input
            type="date"
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
            className="text-sm bg-background border border-border rounded px-2 py-1.5 outline-none focus:border-primary"
          />
        </label>
      </div>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button onClick={onCancel} className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          Cancelar
        </button>
        <button
          onClick={submit}
          disabled={saving}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} {editing ? 'Guardar cambios' : 'Crear meta'}
        </button>
      </div>
    </div>
  )
}

// ── Anillo de progreso (SVG) ───────────────────────────────────────────────────
function ProgressRing({ pct, size = 56, stroke = 5 }: { pct: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.max(0, Math.min(100, pct))
  const offset = c - (clamped / 100) * c
  const done = clamped >= 100
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-muted" />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          strokeLinecap="round"
          className={cn('transition-all duration-500', done ? 'stroke-emerald-500' : 'stroke-primary')}
          style={{ strokeDasharray: c, strokeDashoffset: offset }}
        />
      </svg>
      <span className="absolute inset-0 grid place-items-center text-sm font-semibold text-foreground">
        {clamped}%
      </span>
    </div>
  )
}

// ── Tarjeta de meta ────────────────────────────────────────────────────────────
function GoalCard({
  goal, workspaceId, onEdit, onUpdated, onDeleted,
}: {
  goal: Goal
  workspaceId: string
  onEdit: () => void
  onUpdated: (g: Goal) => void
  onDeleted: (id: string) => void
}) {
  const [showTasks, setShowTasks] = useState(false)
  const [editingValue, setEditingValue] = useState(false)
  const [valueDraft, setValueDraft] = useState(String(goal.current_value))
  const pct = progressPct(goal)
  const meta = STATUS_META[goal.status] ?? STATUS_META.on_track

  async function patch(patchBody: Partial<Goal>) {
    try {
      const res = await fetch(`/api/goals/${goal.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      })
      if (!res.ok) throw new Error()
      const { goal: updated } = await res.json()
      onUpdated({ ...goal, ...updated })
    } catch {
      toast.error('Error al actualizar la meta')
    }
  }

  async function remove() {
    if (!(await confirmDialog({ message: '¿Borrar esta meta? Se quitarán también los enlaces a tareas.', destructive: true, confirmLabel: 'Borrar' }))) return
    onDeleted(goal.id)
    try {
      const res = await fetch(`/api/goals/${goal.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      toast.error('Error al borrar la meta')
    }
  }

  function saveValue() {
    setEditingValue(false)
    const n = Number(valueDraft)
    if (Number.isFinite(n) && n !== goal.current_value) patch({ current_value: n })
  }

  const dueSoon = goal.due_date && new Date(goal.due_date) < new Date() && goal.status !== 'done'

  return (
    <div className="group rounded-lg border border-border bg-card p-4 transition-all hover:border-primary/30 hover:shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-foreground truncate">{goal.title}</h3>
          {goal.description && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{goal.description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Selector de estado */}
          <div className="relative">
            <select
              value={goal.status}
              onChange={e => patch({ status: e.target.value })}
              className={cn('appearance-none text-[11px] font-medium rounded-full pl-5 pr-6 py-1 outline-none cursor-pointer border-0', meta.bg, meta.text)}
            >
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </select>
            <span className={cn('absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full pointer-events-none', meta.dot)} />
            <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
          </div>
          <button onClick={onEdit} aria-label="Editar meta" className="p-1 text-muted-foreground hover:text-foreground transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={remove} aria-label="Borrar meta" className="p-1 text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Barra de progreso */}
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] text-muted-foreground">
            {goal.progress_mode === 'manual' && goal.unit !== 'percent' ? (
              editingValue ? (
                <input
                  autoFocus
                  value={valueDraft}
                  onChange={e => setValueDraft(e.target.value)}
                  onBlur={saveValue}
                  onKeyDown={e => { if (e.key === 'Enter') saveValue() }}
                  className="w-20 text-[11px] bg-background border border-border rounded px-1 py-0.5 outline-none focus:border-primary"
                />
              ) : (
                <button onClick={() => { setValueDraft(String(goal.current_value)); setEditingValue(true) }} className="hover:text-foreground transition-colors">
                  {formatValue(goal)}
                </button>
              )
            ) : goal.progress_mode === 'manual' && goal.unit === 'percent' ? (
              editingValue ? (
                <input
                  autoFocus
                  type="number"
                  value={valueDraft}
                  onChange={e => setValueDraft(e.target.value)}
                  onBlur={saveValue}
                  onKeyDown={e => { if (e.key === 'Enter') saveValue() }}
                  className="w-16 text-[11px] bg-background border border-border rounded px-1 py-0.5 outline-none focus:border-primary"
                />
              ) : (
                <button onClick={() => { setValueDraft(String(goal.current_value)); setEditingValue(true) }} className="hover:text-foreground transition-colors">
                  {formatValue(goal)}
                </button>
              )
            ) : (
              <span>{formatValue(goal)}</span>
            )}
          </span>
          <span className="text-[11px] font-medium text-foreground">{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', goal.status === 'done' ? 'bg-blue-500' : pct >= 100 ? 'bg-emerald-500' : meta.dot)}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Pie: responsable, fecha, tareas */}
      <div className="flex items-center gap-3 mt-3 text-[11px] text-muted-foreground">
        {goal.owner && (
          <span className="inline-flex items-center gap-1">
            {goal.owner.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={goal.owner.avatar_url}
                alt={goal.owner.display_name ?? 'Responsable'}
                className="w-4 h-4 rounded-full object-cover"
              />
            ) : (
              <span className="w-4 h-4 rounded-full bg-primary/15 text-primary grid place-items-center text-[9px] font-medium">
                {(goal.owner.display_name ?? '?').charAt(0).toUpperCase()}
              </span>
            )}
            {goal.owner.display_name ?? 'Sin nombre'}
          </span>
        )}
        {goal.due_date && (
          dueSoon ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-1.5 py-0.5 font-medium">
              <Calendar className="w-3 h-3" /> {goal.due_date}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Calendar className="w-3 h-3" /> {goal.due_date}
            </span>
          )
        )}
        {goal.progress_mode === 'tasks' && (
          <button
            onClick={() => setShowTasks(v => !v)}
            className="inline-flex items-center gap-1 hover:text-foreground transition-colors ml-auto"
          >
            <Link2 className="w-3 h-3" /> {showTasks ? 'Ocultar tareas' : 'Tareas enlazadas'}
          </button>
        )}
      </div>

      {showTasks && goal.progress_mode === 'tasks' && (
        <GoalTasksPanel
          goalId={goal.id}
          workspaceId={workspaceId}
          onCountChange={(done, total) => onUpdated({ ...goal, task_done: done, task_count: total, current_value: done, target_value: total })}
        />
      )}
    </div>
  )
}

// ── Panel de tareas enlazadas ──────────────────────────────────────────────────
function GoalTasksPanel({
  goalId, workspaceId, onCountChange,
}: {
  goalId: string
  workspaceId: string
  onCountChange: (done: number, total: number) => void
}) {
  const [tasks, setTasks] = useState<LinkedTask[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchTask[]>([])
  const [searching, setSearching] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const emitCount = useCallback((list: LinkedTask[]) => {
    const done = list.filter(t => t.status?.category === 'done').length
    onCountChange(done, list.length)
  }, [onCountChange])

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetch(`/api/goals/${goalId}/tasks`)
      .then(r => (r.ok ? r.json() : { tasks: [] }))
      .then(data => { if (alive) { setTasks(data.tasks ?? []); emitCount(data.tasks ?? []) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    const q = query.trim()
    if (q.length < 2) { setResults([]); return }
    debounceRef.current = setTimeout(() => {
      setSearching(true)
      fetch(`/api/search?q=${encodeURIComponent(q)}&workspace_id=${workspaceId}`)
        .then(r => (r.ok ? r.json() : { tasks: [] }))
        .then(data => setResults((data.tasks ?? []).filter((t: SearchTask) => !tasks.some(x => x.id === t.id))))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }, 250)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, workspaceId, tasks])

  async function link(t: SearchTask) {
    try {
      const res = await fetch(`/api/goals/${goalId}/tasks`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: t.id }),
      })
      if (!res.ok) throw new Error()
      const { task } = await res.json()
      const next = [...tasks, task]
      setTasks(next); emitCount(next); setQuery(''); setResults([])
    } catch {
      toast.error('Error al enlazar la tarea')
    }
  }

  async function unlink(t: LinkedTask) {
    const next = tasks.filter(x => x.id !== t.id)
    setTasks(next); emitCount(next)
    try {
      const res = await fetch(`/api/goals/${goalId}/tasks?taskId=${t.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
    } catch {
      setTasks(tasks); emitCount(tasks)
      toast.error('Error al quitar la tarea')
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-border space-y-2">
      <div className="relative">
        <div className="flex items-center gap-2 px-2 py-1 rounded border border-border">
          <Search className="w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar tarea del workspace para enlazar..."
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground/60"
          />
          {searching && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
        </div>
        {results.length > 0 && (
          <div className="absolute z-10 left-0 right-0 mt-1 max-h-44 overflow-y-auto rounded-md border border-border bg-popover shadow-md">
            {results.map(r => (
              <button
                key={r.id}
                onClick={() => link(r)}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-muted/60 truncate"
              >
                {r.title}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 text-muted-foreground animate-spin" /></div>
      ) : tasks.length === 0 ? (
        <p className="text-[11px] text-muted-foreground/70">Sin tareas enlazadas.</p>
      ) : (
        <div className="space-y-0.5">
          {tasks.map(t => (
            <div key={t.id} className="group flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/40 transition-colors">
              <span
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: t.status?.color ?? '#94a3b8' }}
                title={t.status?.name ?? 'Sin estado'}
              />
              <span className={cn('flex-1 text-sm truncate', t.status?.category === 'done' ? 'line-through text-muted-foreground' : 'text-foreground')}>
                {t.title}
              </span>
              <button
                onClick={() => unlink(t)}
                className="opacity-0 group-hover:opacity-100 p-0.5 text-muted-foreground hover:text-destructive transition-all flex-shrink-0"
                aria-label="Quitar tarea"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

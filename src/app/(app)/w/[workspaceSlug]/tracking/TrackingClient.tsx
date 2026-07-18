'use client'

/**
 * Timesheet personal: vistas Hoy / Esta semana, totales por proyecto y por dia,
 * grafico de horas por dia (recharts) y entradas editables (nota + horas) o
 * borrables. Alta manual de una entrada eligiendo una tarea asignada.
 *
 * Todo se agrupa en HORA LOCAL del navegador (el server manda ISO en UTC). El
 * timer activo suma en vivo. Iconos lucide, sin emojis.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { confirmDialog } from '@/components/ConfirmDialog'
import {
  BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, CartesianGrid,
} from 'recharts'
import {
  Clock, Timer, CalendarDays, FolderGit2, Plus, Pencil, Trash2, X, Check,
} from 'lucide-react'
import { cn } from '@/lib/utils'

export interface TimeEntry {
  id: string
  task_id: string | null
  project_id: string
  started_at: string
  ended_at: string | null
  duration_sec: number | null
  note: string | null
  task: { id: string; title: string } | null
  project: { id: string; name: string } | null
}

export interface TrackTaskOption {
  id: string
  title: string
  project_name: string | null
}

const DOW = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

// ── Helpers de tiempo (hora local) ──────────────────────────────────────────
function startOfDayLocal(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x }
function startOfWeekLocal(d: Date): Date {
  const x = startOfDayLocal(d)
  const day = (x.getDay() + 6) % 7 // 0 = lunes
  x.setDate(x.getDate() - day)
  return x
}
function dayKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
function effSec(e: TimeEntry, nowMs: number): number {
  if (e.ended_at) return e.duration_sec ?? Math.round((new Date(e.ended_at).getTime() - new Date(e.started_at).getTime()) / 1000)
  return Math.max(0, Math.round((nowMs - new Date(e.started_at).getTime()) / 1000))
}
function fmtHms(sec: number): string {
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m`
  return `${s}s`
}
function fmtHours(sec: number): string { return `${(sec / 3600).toFixed(2)} h` }
function fmtHm(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function toLocalInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromLocalInput(v: string): string { return new Date(v).toISOString() }

type Tab = 'hoy' | 'semana'

export function TrackingClient({
  workspaceName, entries, running, taskOptions,
}: {
  workspaceName: string
  entries: TimeEntry[]
  running: TimeEntry | null
  taskOptions: TrackTaskOption[]
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('hoy')
  const [now, setNow] = useState(() => Date.now())

  // Reloj vivo solo si hay timer corriendo.
  useEffect(() => {
    if (!running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [running])

  const todayKey = dayKey(new Date(now))
  const weekStart = startOfWeekLocal(new Date(now)).getTime()

  const todayEntries = useMemo(
    () => entries.filter(e => dayKey(new Date(e.started_at)) === todayKey),
    [entries, todayKey],
  )
  const weekEntries = useMemo(
    () => entries.filter(e => new Date(e.started_at).getTime() >= weekStart),
    [entries, weekStart],
  )

  const todayTotal = todayEntries.reduce((a, e) => a + effSec(e, now), 0)
  const weekTotal = weekEntries.reduce((a, e) => a + effSec(e, now), 0)

  // Grafico: horas por dia de la semana en curso.
  const chartData = useMemo(() => {
    const base = startOfWeekLocal(new Date(now))
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(base); d.setDate(base.getDate() + i)
      const k = dayKey(d)
      const sec = entries.reduce((acc, e) => dayKey(new Date(e.started_at)) === k ? acc + effSec(e, now) : acc, 0)
      return { label: DOW[i], horas: Number((sec / 3600).toFixed(2)) }
    })
  }, [entries, now])

  const rangeEntries = tab === 'hoy' ? todayEntries : weekEntries

  // Totales por proyecto en el rango activo.
  const byProject = useMemo(() => {
    const map = new Map<string, { name: string; sec: number }>()
    for (const e of rangeEntries) {
      const key = e.project_id
      const name = e.project?.name ?? 'Proyecto'
      const prev = map.get(key)
      map.set(key, { name, sec: (prev?.sec ?? 0) + effSec(e, now) })
    }
    return Array.from(map.values()).sort((a, b) => b.sec - a.sec)
  }, [rangeEntries, now])
  const projectMax = byProject.reduce((m, p) => Math.max(m, p.sec), 0) || 1

  // Entradas agrupadas por dia (rango activo).
  const grouped = useMemo(() => {
    const map = new Map<string, TimeEntry[]>()
    for (const e of rangeEntries) {
      const k = dayKey(new Date(e.started_at))
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(e)
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [rangeEntries])

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
            <Clock className="w-5 h-5 text-muted-foreground" /> Seguimiento de tiempo
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{workspaceName}</p>
        </div>
        <ManualAdd taskOptions={taskOptions} onSaved={() => router.refresh()} />
      </div>

      {/* Tarjetas resumen */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryCard icon={<CalendarDays className="w-4 h-4" />} label="Hoy" value={fmtHms(todayTotal)} />
        <SummaryCard icon={<CalendarDays className="w-4 h-4" />} label="Esta semana" value={fmtHms(weekTotal)} />
        <RunningCard running={running} now={now} />
      </div>

      {/* Grafico semanal */}
      <section className="bg-card border border-border rounded-xl p-5">
        <h2 className="text-sm font-semibold text-foreground mb-4">Horas por día (esta semana)</h2>
        <div className="h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }} axisLine={false} tickLine={false} allowDecimals />
              <Tooltip
                cursor={{ fill: 'hsl(var(--muted))', opacity: 0.4 }}
                contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 12 }}
                formatter={(v: number) => [`${v} h`, 'Horas']}
              />
              <Bar dataKey="horas" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} maxBarSize={44} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Tabs */}
      <div className="flex items-center gap-2">
        <TabButton active={tab === 'hoy'} onClick={() => setTab('hoy')} label="Hoy" />
        <TabButton active={tab === 'semana'} onClick={() => setTab('semana')} label="Esta semana" />
      </div>

      {/* Totales por proyecto */}
      {byProject.length > 0 && (
        <section className="bg-card border border-border rounded-xl p-5">
          <h2 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <FolderGit2 className="w-4 h-4 text-muted-foreground" /> Por proyecto
          </h2>
          <div className="space-y-2.5">
            {byProject.map(p => (
              <div key={p.name} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-foreground truncate">{p.name}</span>
                  <span className="text-muted-foreground tabular-nums">{fmtHours(p.sec)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${(p.sec / projectMax) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Entradas */}
      {grouped.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-xl">
          <Timer className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <h3 className="text-sm font-medium text-foreground mb-1">Sin registros</h3>
          <p className="text-sm text-muted-foreground">
            Inicia un timer desde Mis tareas o agrega una entrada manual.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([key, list]) => {
            const dayTotal = list.reduce((a, e) => a + effSec(e, now), 0)
            const dLabel = new Date(list[0].started_at).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' })
            return (
              <div key={key}>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-medium text-muted-foreground capitalize">{dLabel}</h3>
                  <span className="text-xs text-muted-foreground tabular-nums">{fmtHms(dayTotal)}</span>
                </div>
                <div className="space-y-1.5">
                  {list.map(e => (
                    <EntryRow key={e.id} entry={e} now={now} onChanged={() => router.refresh()} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Tarjetas ────────────────────────────────────────────────────────────────
function SummaryCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">{icon}<span className="text-xs">{label}</span></div>
      <p className="text-2xl font-semibold text-foreground tabular-nums">{value}</p>
    </div>
  )
}

function RunningCard({ running, now }: { running: TimeEntry | null; now: number }) {
  if (!running) {
    return (
      <div className="bg-card border border-border rounded-xl p-4">
        <div className="flex items-center gap-1.5 text-muted-foreground mb-1"><Timer className="w-4 h-4" /><span className="text-xs">Timer activo</span></div>
        <p className="text-sm text-muted-foreground mt-1.5">Ninguno en curso</p>
      </div>
    )
  }
  const sec = effSec(running, now)
  return (
    <div className="bg-card border border-red-500/30 rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-red-600 mb-1"><Timer className="w-4 h-4" /><span className="text-xs">Timer activo</span></div>
      <p className="text-2xl font-semibold text-foreground tabular-nums">{fmtHms(sec)}</p>
      <p className="text-xs text-muted-foreground truncate mt-0.5">{running.task?.title ?? 'Tarea'}</p>
    </div>
  )
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-xs rounded-full border transition-colors',
        active
          ? 'bg-primary text-primary-foreground border-transparent'
          : 'bg-background text-muted-foreground border-border hover:text-foreground hover:border-ring',
      )}
    >
      {label}
    </button>
  )
}

// ── Fila de entrada (ver / editar / borrar) ─────────────────────────────────
function EntryRow({ entry, now, onChanged }: { entry: TimeEntry; now: number; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [start, setStart] = useState(() => toLocalInput(entry.started_at))
  const [end, setEnd] = useState(() => entry.ended_at ? toLocalInput(entry.ended_at) : '')
  const [note, setNote] = useState(entry.note ?? '')
  const [busy, setBusy] = useState(false)
  const isRunning = entry.ended_at === null

  const save = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/time-entries/${entry.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          started_at: fromLocalInput(start),
          ...(end ? { ended_at: fromLocalInput(end) } : {}),
          note: note.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar')
      toast.success('Entrada actualizada')
      setEditing(false)
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!(await confirmDialog({ message: '¿Borrar esta entrada de tiempo?', destructive: true, confirmLabel: 'Borrar' }))) return
    setBusy(true)
    try {
      const res = await fetch(`/api/time-entries/${entry.id}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo borrar')
      toast.success('Entrada borrada')
      onChanged()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al borrar')
    } finally {
      setBusy(false)
    }
  }

  if (editing) {
    return (
      <div className="bg-card border border-ring/40 rounded-lg p-3 space-y-2.5">
        <p className="text-sm font-medium text-foreground truncate">{entry.task?.title ?? 'Tarea'}</p>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-muted-foreground">
            Inicio
            <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)}
              className="mt-0.5 w-full px-2 py-1.5 text-xs border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
          </label>
          <label className="text-[11px] text-muted-foreground">
            Fin
            <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)} disabled={isRunning}
              className="mt-0.5 w-full px-2 py-1.5 text-xs border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50" />
          </label>
        </div>
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="Nota (opcional)" maxLength={1000}
          className="w-full px-2 py-1.5 text-xs border border-input rounded-md bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs border border-border rounded-md hover:bg-muted transition-colors disabled:opacity-50">
            <X className="w-3.5 h-3.5" /> Cancelar
          </button>
          <button type="button" onClick={save} disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50">
            <Check className="w-3.5 h-3.5" /> Guardar
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="group flex items-center gap-3 bg-card border border-border rounded-lg px-3 py-2.5 hover:border-ring/30 transition-colors">
      <span className={cn('flex-shrink-0 w-2 h-2 rounded-full', isRunning ? 'bg-red-500 animate-pulse' : 'bg-muted-foreground/40')} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{entry.task?.title ?? 'Tarea'}</p>
        <p className="text-[11px] text-muted-foreground truncate">
          {entry.project?.name ?? 'Proyecto'} · {fmtHm(entry.started_at)}{entry.ended_at ? ` - ${fmtHm(entry.ended_at)}` : ' · en curso'}
          {entry.note ? ` · ${entry.note}` : ''}
        </p>
      </div>
      <span className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">{fmtHms(effSec(entry, now))}</span>
      <div className="flex-shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button type="button" onClick={() => setEditing(true)} disabled={busy} title="Editar"
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
          <Pencil className="w-3.5 h-3.5" />
        </button>
        <button type="button" onClick={remove} disabled={busy} title="Borrar"
          className="p-1 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Alta manual ─────────────────────────────────────────────────────────────
function ManualAdd({ taskOptions, onSaved }: { taskOptions: TrackTaskOption[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [taskId, setTaskId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const reset = () => { setTaskId(''); setStart(''); setEnd(''); setNote('') }

  const save = async () => {
    if (!taskId) { toast.error('Elige una tarea'); return }
    if (!start || !end) { toast.error('Indica inicio y fin'); return }
    setBusy(true)
    try {
      const res = await fetch('/api/time-entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task_id: taskId,
          started_at: fromLocalInput(start),
          ended_at: fromLocalInput(end),
          note: note.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'No se pudo guardar')
      toast.success('Entrada agregada')
      reset(); setOpen(false); onSaved()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Error al guardar')
    } finally {
      setBusy(false)
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors">
        <Plus className="w-4 h-4" /> Agregar manual
      </button>
    )
  }

  return (
    <div className="w-full sm:w-auto bg-card border border-ring/40 rounded-xl p-4 space-y-2.5">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Nueva entrada</p>
        <button type="button" onClick={() => { reset(); setOpen(false) }} className="p-1 text-muted-foreground hover:text-foreground">
          <X className="w-4 h-4" />
        </button>
      </div>
      <select value={taskId} onChange={e => setTaskId(e.target.value)}
        className="w-full px-2 py-1.5 text-xs border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring">
        <option value="">Elige una tarea...</option>
        {taskOptions.map(t => (
          <option key={t.id} value={t.id}>{t.title}{t.project_name ? ` (${t.project_name})` : ''}</option>
        ))}
      </select>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-muted-foreground">
          Inicio
          <input type="datetime-local" value={start} onChange={e => setStart(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 text-xs border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
        <label className="text-[11px] text-muted-foreground">
          Fin
          <input type="datetime-local" value={end} onChange={e => setEnd(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 text-xs border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring" />
        </label>
      </div>
      <input value={note} onChange={e => setNote(e.target.value)} placeholder="Nota (opcional)" maxLength={1000}
        className="w-full px-2 py-1.5 text-xs border border-input rounded-md bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring" />
      <div className="flex items-center justify-end">
        <button type="button" onClick={save} disabled={busy}
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors disabled:opacity-50">
          <Check className="w-3.5 h-3.5" /> Guardar
        </button>
      </div>
    </div>
  )
}

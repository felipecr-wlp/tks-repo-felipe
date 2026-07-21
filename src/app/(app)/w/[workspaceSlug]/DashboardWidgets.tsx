/**
 * DashboardWidgets, banda de métricas del inicio del workspace.
 * Componente de servidor puro (sin estado): recibe los agregados ya calculados
 * en la página y solo los pinta. Widgets: tareas por estado, vencidas / por
 * vencer, y carga por persona. La actividad reciente vive aparte en la home.
 */
import Link from 'next/link'
import Image from 'next/image'
import { getInitials } from '@/lib/utils'
import { AlertTriangle, CalendarClock, ListChecks, Users } from 'lucide-react'

export interface DashboardWidgetsData {
  totalOpen: number
  overdue: number
  dueSoon: number
  byCategory: { todo: number; in_progress: number; done: number; cancelled: number }
  workload: Array<{ id: string; name: string; avatar_url: string | null; open: number }>
}

const CATEGORY_META: Array<{ key: keyof DashboardWidgetsData['byCategory']; label: string; color: string }> = [
  { key: 'todo',        label: 'Por hacer',   color: '#94a3b8' },
  { key: 'in_progress', label: 'En progreso', color: '#2563EB' },
  { key: 'done',        label: 'Hechas',      color: '#22c55e' },
  { key: 'cancelled',   label: 'Canceladas',  color: '#f43f5e' },
]

export function DashboardWidgets({
  data,
  myTasksHref,
}: {
  data: DashboardWidgetsData
  myTasksHref: string
}) {
  const { totalOpen, overdue, dueSoon, byCategory, workload } = data
  const totalAll = byCategory.todo + byCategory.in_progress + byCategory.done + byCategory.cancelled
  const maxWorkload = Math.max(1, ...workload.map(w => w.open))

  return (
    <section className="mb-10">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
        Resumen
      </h2>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Tareas por estado ──────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-soft">
          <div className="flex items-center gap-2 mb-3">
            <ListChecks className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">Tareas por estado</h3>
          </div>

          {totalAll === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Aún no hay tareas</p>
          ) : (
            <>
              {/* Barra apilada por categoría */}
              <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted mb-3">
                {CATEGORY_META.map(c => {
                  const n = byCategory[c.key]
                  if (n === 0) return null
                  return (
                    <div
                      key={c.key}
                      style={{ width: `${(n / totalAll) * 100}%`, backgroundColor: c.color }}
                      title={`${c.label}: ${n}`}
                    />
                  )
                })}
              </div>
              <ul className="space-y-1.5">
                {CATEGORY_META.map(c => (
                  <li key={c.key} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                    <span className="text-muted-foreground flex-1">{c.label}</span>
                    <span className="font-medium text-foreground tabular-nums">{byCategory[c.key]}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {/* ── Vencidas / por vencer ──────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-soft flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <CalendarClock className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">Fechas límite</h3>
          </div>

          <div className="grid grid-cols-2 gap-3 flex-1">
            <Link
              href={myTasksHref}
              className="flex flex-col justify-center rounded-lg border border-border bg-muted/20 px-3 py-3 hover:border-rose-400/50 transition-colors"
            >
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                Vencidas
              </span>
              <span className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{overdue}</span>
            </Link>
            <Link
              href={myTasksHref}
              className="flex flex-col justify-center rounded-lg border border-border bg-muted/20 px-3 py-3 hover:border-amber-400/50 transition-colors"
            >
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <CalendarClock className="w-3.5 h-3.5 text-amber-500" />
                Próximos 7 días
              </span>
              <span className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{dueSoon}</span>
            </Link>
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">
            {totalOpen} {totalOpen === 1 ? 'tarea abierta' : 'tareas abiertas'} en total
          </p>
        </div>

        {/* ── Carga por persona ──────────────────────────────────────────── */}
        <div className="bg-card border border-border rounded-xl p-4 shadow-soft">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-muted-foreground" />
            <h3 className="text-sm font-medium text-foreground">Carga por persona</h3>
          </div>

          {workload.length === 0 ? (
            <p className="text-xs text-muted-foreground py-6 text-center">Sin tareas asignadas</p>
          ) : (
            <ul className="space-y-2.5">
              {workload.map(w => (
                <li key={w.id} className="flex items-center gap-2.5">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full overflow-hidden bg-muted flex items-center justify-center text-[10px] font-medium text-muted-foreground">
                    {w.avatar_url ? (
                      <Image src={w.avatar_url} alt={w.name} width={24} height={24} className="w-full h-full object-cover" />
                    ) : (
                      getInitials(w.name)
                    )}
                  </span>
                  <span className="text-xs text-foreground truncate flex-1 min-w-0">{w.name}</span>
                  <span className="flex items-center gap-2 flex-shrink-0 w-24">
                    <span className="h-1.5 flex-1 rounded-full bg-muted overflow-hidden">
                      <span
                        className="block h-full rounded-full bg-primary"
                        style={{ width: `${(w.open / maxWorkload) * 100}%` }}
                      />
                    </span>
                    <span className="text-[11px] text-muted-foreground tabular-nums w-4 text-right">{w.open}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}

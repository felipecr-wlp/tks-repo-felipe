'use client'

/**
 * AnalyticsView, capa presentacional de la Analítica de entrega.
 *
 * Todo el cómputo vive en el server component (page.tsx); aquí solo se pinta.
 * Gráficas sin dependencias: barras con flex/CSS y líneas con SVG en línea,
 * al estilo ligero del resto de la app (DashboardWidgets). Iconos de lucide.
 *
 * Bloques:
 *   - Tarjetas de resumen (throughput, ciclo promedio, mediana, tareas del periodo)
 *   - Barras de throughput semanal
 *   - Velocidad por sprint (planeado vs hecho) + tabla compacta
 *   - Burndown del sprint activo (líneas ideal punteada y real sólida)
 */
import {
  Activity,
  Timer,
  GitBranch,
  CheckCircle2,
  BarChart3,
  TrendingDown,
} from 'lucide-react'
import type {
  ThroughputWeek,
  CycleTime,
  VelocitySprint,
  BurndownPoint,
} from '@/app/(app)/w/[workspaceSlug]/analytics/page'

// ── Utilidades de formato ────────────────────────────────────────────────────
function fmtWeekLabel(iso: string): string {
  // "YYYY-MM-DD" a "d MMM" en español, sin desfase de zona horaria.
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function fmtDate(iso: string | null): string {
  if (!iso) return 'Sin fecha'
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function round1(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('es-MX')
}

// ── Tarjeta de estadística ───────────────────────────────────────────────────
function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-soft">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-muted-foreground">{icon}</span>
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
      </div>
      <p className="text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}

// ── Estado vacío reutilizable ────────────────────────────────────────────────
function EmptyState({ message }: { message: string }) {
  return (
    <div className="bg-card border border-border rounded-xl px-4 py-10 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}

// ── Gráfica de throughput semanal (barras CSS) ───────────────────────────────
function ThroughputChart({ weeks }: { weeks: ThroughputWeek[] }) {
  const maxTasks = Math.max(1, ...weeks.map((w) => w.tasks_done))

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-soft">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">Throughput semanal</h3>
        <span className="ml-auto text-[11px] text-muted-foreground">tareas completadas por semana</span>
      </div>

      {weeks.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          Aún no hay semanas con tareas completadas.
        </p>
      ) : (
        <div className="flex items-end gap-1.5 h-40" role="img" aria-label="Barras de tareas completadas por semana">
          {weeks.map((w) => {
            const pct = (w.tasks_done / maxTasks) * 100
            return (
              <div key={w.week_start} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                <span className="text-[10px] tabular-nums text-muted-foreground">{w.tasks_done}</span>
                <div className="w-full flex-1 flex items-end">
                  <div
                    className="w-full rounded-t bg-primary/80 hover:bg-primary transition-colors"
                    style={{ height: `${Math.max(pct, 2)}%` }}
                    title={`${fmtWeekLabel(w.week_start)}: ${w.tasks_done} tareas, ${w.points_done} pts`}
                  />
                </div>
                <span className="text-[9px] text-muted-foreground truncate w-full text-center">
                  {fmtWeekLabel(w.week_start)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Gráfica de velocidad por sprint (planeado vs hecho) ──────────────────────
function VelocityChart({ sprints }: { sprints: VelocitySprint[] }) {
  // El RPC entrega del más reciente al más antiguo; para leer de izquierda a
  // derecha en orden cronológico invertimos para la gráfica de barras.
  const chartOrder = [...sprints].reverse()
  const maxPoints = Math.max(
    1,
    ...sprints.map((s) => Math.max(s.planned_points, s.done_points))
  )

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-soft">
      <div className="flex items-center gap-2 mb-4">
        <GitBranch className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">Velocidad por sprint</h3>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-muted-foreground/40" />
            Planeado
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" />
            Hecho
          </span>
        </div>
      </div>

      {sprints.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">
          Aún no hay sprints con puntos para mostrar velocidad.
        </p>
      ) : (
        <>
          <div className="flex items-end gap-3 h-44 mb-5" role="img" aria-label="Puntos planeados contra hechos por sprint">
            {chartOrder.map((s) => {
              const plannedPct = (s.planned_points / maxPoints) * 100
              const donePct = (s.done_points / maxPoints) * 100
              return (
                <div key={s.sprint_id} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                  <div className="w-full flex-1 flex items-end justify-center gap-1">
                    <div
                      className="w-1/2 max-w-[1.75rem] rounded-t bg-muted-foreground/40"
                      style={{ height: `${Math.max(plannedPct, 2)}%` }}
                      title={`Planeado: ${s.planned_points} pts`}
                    />
                    <div
                      className="w-1/2 max-w-[1.75rem] rounded-t bg-emerald-500"
                      style={{ height: `${Math.max(donePct, 2)}%` }}
                      title={`Hecho: ${s.done_points} pts`}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground truncate w-full text-center">
                    {s.sprint_name}
                  </span>
                </div>
              )
            })}
          </div>

          {/* Tabla compacta */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground border-b border-border">
                  <th className="px-2 py-2 font-medium">Sprint</th>
                  <th className="px-2 py-2 font-medium">Fin</th>
                  <th className="px-2 py-2 font-medium text-right">Planeado</th>
                  <th className="px-2 py-2 font-medium text-right">Hecho</th>
                  <th className="px-2 py-2 font-medium text-right">Avance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sprints.map((s) => {
                  const pct = s.planned_points > 0 ? Math.round((s.done_points / s.planned_points) * 100) : null
                  return (
                    <tr key={s.sprint_id} className="hover:bg-accent/40 transition-colors">
                      <td className="px-2 py-2.5">
                        <span className="font-medium text-foreground">{s.sprint_name}</span>
                        {s.status === 'active' ? (
                          <span className="ml-2 text-[10px] font-medium text-emerald-600 uppercase tracking-wide">
                            activo
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2.5 text-muted-foreground">{fmtDate(s.end_date)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                        {s.planned_points}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">
                        {s.done_points}
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums font-medium text-foreground">
                        {pct != null ? `${pct}%` : 'n/d'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

// ── Gráfica de burndown (SVG en línea) ───────────────────────────────────────
function BurndownChart({
  points,
  sprintName,
}: {
  points: BurndownPoint[]
  sprintName: string | null
}) {
  const W = 640
  const H = 220
  const PAD = { top: 16, right: 16, bottom: 28, left: 32 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  // Máximo del eje Y sobre ambas series (ideal puede venir null en algún punto).
  const maxVal = Math.max(
    1,
    ...points.map((p) => Math.max(p.actual_remaining, p.ideal_remaining ?? 0))
  )
  const n = points.length

  const xAt = (i: number) => PAD.left + (n <= 1 ? 0 : (i / (n - 1)) * innerW)
  const yAt = (v: number) => PAD.top + innerH - (v / maxVal) * innerH

  const actualLine = points.map((p, i) => `${xAt(i)},${yAt(p.actual_remaining)}`).join(' ')
  const idealPts = points
    .map((p, i) => (p.ideal_remaining != null ? `${xAt(i)},${yAt(p.ideal_remaining)}` : null))
    .filter((s): s is string => s != null)
    .join(' ')

  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-soft">
      <div className="flex items-center gap-2 mb-4">
        <TrendingDown className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">Burndown del sprint activo</h3>
        {sprintName ? (
          <span className="ml-auto text-[11px] text-muted-foreground truncate max-w-[12rem]">{sprintName}</span>
        ) : null}
      </div>

      {points.length === 0 ? (
        <EmptyState message="No hay sprint activo para mostrar burndown." />
      ) : (
        <>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mb-2">
            <span className="inline-flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden="true">
                <line x1="0" y1="3" x2="18" y2="3" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
              </svg>
              Ideal
            </span>
            <span className="inline-flex items-center gap-1.5">
              <svg width="18" height="6" aria-hidden="true">
                <line x1="0" y1="3" x2="18" y2="3" stroke="#2563EB" strokeWidth="2" />
              </svg>
              Real
            </span>
          </div>

          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto"
            role="img"
            aria-label="Líneas de trabajo restante ideal contra real por día"
          >
            {/* Ejes */}
            <line
              x1={PAD.left}
              y1={PAD.top}
              x2={PAD.left}
              y2={PAD.top + innerH}
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
            />
            <line
              x1={PAD.left}
              y1={PAD.top + innerH}
              x2={PAD.left + innerW}
              y2={PAD.top + innerH}
              stroke="currentColor"
              className="text-border"
              strokeWidth="1"
            />
            {/* Marcas del eje Y (0, mitad, máximo) */}
            {[0, maxVal / 2, maxVal].map((v, i) => (
              <text
                key={i}
                x={PAD.left - 6}
                y={yAt(v) + 3}
                textAnchor="end"
                className="fill-muted-foreground"
                fontSize="9"
              >
                {Math.round(v)}
              </text>
            ))}
            {/* Línea ideal (punteada) */}
            {idealPts ? (
              <polyline
                points={idealPts}
                fill="none"
                stroke="currentColor"
                className="text-muted-foreground"
                strokeWidth="1.5"
                strokeDasharray="4 3"
              />
            ) : null}
            {/* Línea real (sólida) */}
            <polyline points={actualLine} fill="none" stroke="#2563EB" strokeWidth="2" />
          </svg>

          <div className="flex justify-between mt-1 text-[9px] text-muted-foreground">
            <span>{fmtDate(points[0].day)}</span>
            <span>{fmtDate(points[points.length - 1].day)}</span>
          </div>
        </>
      )}
    </div>
  )
}

// ── Vista principal ──────────────────────────────────────────────────────────
export function AnalyticsView({
  workspaceName,
  weeks,
  cycleDays,
  throughput,
  cycle,
  velocity,
  burndown,
  activeSprintName,
}: {
  workspaceName: string
  weeks: number
  cycleDays: number
  throughput: ThroughputWeek[]
  cycle: CycleTime | null
  velocity: VelocitySprint[]
  burndown: BurndownPoint[]
  activeSprintName: string | null
}) {
  const totalTasks = throughput.reduce((sum, w) => sum + w.tasks_done, 0)

  return (
    <div className="space-y-6">
      {/* Cabecera */}
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Analítica de entrega</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {workspaceName} · métricas de las últimas {weeks} semanas.
        </p>
      </div>

      {/* Tarjetas de resumen */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Activity className="w-4 h-4" />}
          label="Throughput"
          value={totalTasks.toLocaleString('es-MX')}
          hint={`tareas completadas en ${weeks} semanas`}
        />
        <StatCard
          icon={<Timer className="w-4 h-4" />}
          label="Ciclo promedio"
          value={cycle ? `${round1(cycle.avg_days)} d` : 'n/d'}
          hint={cycle ? `muestra de ${cycle.sample} tareas` : `últimos ${cycleDays} días`}
        />
        <StatCard
          icon={<Timer className="w-4 h-4" />}
          label="Ciclo mediana"
          value={cycle ? `${round1(cycle.median_days)} d` : 'n/d'}
          hint={cycle ? `últimos ${cycleDays} días` : `últimos ${cycleDays} días`}
        />
        <StatCard
          icon={<CheckCircle2 className="w-4 h-4" />}
          label="Tareas del periodo"
          value={totalTasks.toLocaleString('es-MX')}
          hint={`suma semanal (${weeks} semanas)`}
        />
      </div>

      {/* Throughput semanal */}
      <ThroughputChart weeks={throughput} />

      {/* Velocidad por sprint */}
      <VelocityChart sprints={velocity} />

      {/* Burndown del sprint activo */}
      <BurndownChart points={burndown} sprintName={activeSprintName} />
    </div>
  )
}

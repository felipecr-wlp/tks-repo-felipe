/**
 * Analítica de entrega del workspace.
 *
 * Tablero de métricas de entrega calculadas por RPCs de Postgres que YA existen
 * en la base (no se crean aquí). Es un componente de servidor: resuelve el
 * workspace igual que el panel de Rendimiento (getWorkspaceAdminContext), llama
 * los cuatro RPCs y pasa los datos a AnalyticsView (cliente) para pintarlos.
 *
 * RPCs consumidos:
 *   - workspace_throughput_weekly  -> throughput semanal (barras por semana)
 *   - workspace_cycle_time         -> tiempo de ciclo (tarjetas: promedio y mediana)
 *   - workspace_velocity           -> velocidad por sprint (planeado vs hecho + tabla)
 *   - sprint_burndown              -> burndown del sprint activo más reciente
 */
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { AnalyticsView } from '@/components/analytics/AnalyticsView'

// ── Formas de retorno de los RPCs (documentadas por el contrato de la base) ──
export interface ThroughputWeek {
  week_start: string
  tasks_done: number
  points_done: number
}

export interface CycleTime {
  avg_days: number
  median_days: number
  sample: number
}

export interface VelocitySprint {
  sprint_id: string
  sprint_name: string
  end_date: string | null
  status: string
  planned_points: number
  done_points: number
  tasks_total: number
  tasks_done: number
}

export interface BurndownPoint {
  day: string
  ideal_remaining: number | null
  actual_remaining: number
}

const WEEKS = 12
const CYCLE_DAYS = 90
const VELOCITY_LIMIT = 8

export default async function AnalyticsPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')

  const admin = createAdminClient()
  const wsId = ctx.workspace.id

  // ── Los tres RPCs a nivel workspace son independientes: en paralelo ──────────
  const [
    { data: throughput },
    { data: cycleRows },
    { data: velocity },
  ] = await Promise.all([
    admin.rpc('workspace_throughput_weekly', {
      p_workspace_id: wsId,
      p_weeks: WEEKS,
    }) as unknown as Promise<{ data: ThroughputWeek[] | null }>,
    admin.rpc('workspace_cycle_time', {
      p_workspace_id: wsId,
      p_days: CYCLE_DAYS,
    }) as unknown as Promise<{ data: CycleTime[] | null }>,
    admin.rpc('workspace_velocity', {
      p_workspace_id: wsId,
      p_limit: VELOCITY_LIMIT,
    }) as unknown as Promise<{ data: VelocitySprint[] | null }>,
  ])

  const throughputWeeks = throughput ?? []
  // workspace_cycle_time devuelve UNA fila; normalizamos a objeto o null.
  const cycle = cycleRows && cycleRows.length > 0 ? cycleRows[0] : null
  const velocitySprints = velocity ?? []

  // ── Sprint activo para el burndown ───────────────────────────────────────────
  // Primero se busca en el resultado de velocity (status='active', el más reciente
  // ya viene primero). Si velocity no trae uno activo, se consulta sprints por
  // workspace directamente (sprints.workspace_id existe). Si no hay, se omite.
  let activeSprint: { id: string; name: string } | null = null
  const activeFromVelocity = velocitySprints.find((s) => s.status === 'active')
  if (activeFromVelocity) {
    activeSprint = { id: activeFromVelocity.sprint_id, name: activeFromVelocity.sprint_name }
  } else {
    const { data: sprintRow } = (await admin
      .from('sprints')
      .select('id, name')
      .eq('workspace_id', wsId)
      .eq('status', 'active')
      .order('start_date', { ascending: false })
      .limit(1)
      .maybeSingle()) as { data: { id: string; name: string } | null; error: unknown }
    if (sprintRow) activeSprint = sprintRow
  }

  let burndown: BurndownPoint[] = []
  if (activeSprint) {
    const { data: burndownRows } = (await admin.rpc('sprint_burndown', {
      p_sprint_id: activeSprint.id,
    })) as unknown as { data: BurndownPoint[] | null }
    burndown = burndownRows ?? []
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <AnalyticsView
        workspaceName={ctx.workspace.name}
        weeks={WEEKS}
        cycleDays={CYCLE_DAYS}
        throughput={throughputWeeks}
        cycle={cycle}
        velocity={velocitySprints}
        burndown={burndown}
        activeSprintName={activeSprint?.name ?? null}
      />
    </div>
  )
}

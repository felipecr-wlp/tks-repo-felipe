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

// Filas agregadas del rollup de tiempo (por persona y por proyecto).
export interface TimeRollupRow {
  id: string
  name: string
  hours: number
}

export interface TimeRollup {
  totalHours: number
  entryCount: number
  byPerson: TimeRollupRow[]
  byProject: TimeRollupRow[]
}

const WEEKS = 12
const CYCLE_DAYS = 90
const VELOCITY_LIMIT = 8
const TIME_DAYS = 90

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

  // ── Rollup de tiempo registrado (time_entries) ───────────────────────────────
  // Analytics ignoraba por completo el time tracking pese a existir la tabla. Se
  // suma el tiempo del workspace en la misma ventana de CYCLE_DAYS y se desglosa
  // por persona y por proyecto. Las entradas en curso (duration_sec null) no
  // cuentan. La agregacion se hace en el server (no hay RPC dedicado todavia).
  const timeSince = new Date(Date.now() - TIME_DAYS * 24 * 60 * 60 * 1000).toISOString()

  type TimeEntryRow = {
    duration_sec: number | null
    started_at: string
    profile_id: string | null
    project_id: string | null
    subject: { display_name: string | null } | { display_name: string | null }[] | null
    project: { name: string | null } | { name: string | null }[] | null
  }
  // QUIEN VE EL TIEMPO DE QUIEN. `getWorkspaceAdminContext` calcula `isAdmin` y
  // hasta hoy esta pantalla lo IGNORABA: cualquier miembro veia el desglose de
  // horas de todo el mundo, o sea un ranking publico de quien trabajo cuanto.
  // Contradice la regla del reporte diario (no es tablero abierto: cada quien ve
  // lo suyo salvo mando) y no se notaba solo porque no hay tiempo registrado
  // todavia. El dia que alguien empiece a registrar, se enciende solo.
  //
  // El recorte va en la CONSULTA y no al pintar, a proposito: estas paginas leen
  // con el admin client, que se salta RLS. Un filtro puesto en el render deja los
  // datos viajando al navegador igual, y ahi ya se leen.
  let timeQuery = admin
    .from('time_entries')
    .select(`
      duration_sec,
      started_at,
      profile_id,
      project_id,
      subject:profiles ( display_name ),
      project:projects ( name )
    `)
    .eq('workspace_id', wsId)
    .gte('started_at', timeSince)
    .not('duration_sec', 'is', null)

  if (!ctx.isAdmin) timeQuery = timeQuery.eq('profile_id', ctx.userId)

  const { data: timeRows } = (await timeQuery
    .limit(5000)) as { data: TimeEntryRow[] | null; error: unknown }

  const firstOf = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)

  let totalSec = 0
  const personSec = new Map<string, { name: string; sec: number }>()
  const projectSec = new Map<string, { name: string; sec: number }>()

  for (const r of timeRows ?? []) {
    const sec = r.duration_sec ?? 0
    if (sec <= 0) continue
    totalSec += sec

    if (r.profile_id) {
      const name = firstOf(r.subject)?.display_name ?? 'Sin nombre'
      const prev = personSec.get(r.profile_id)
      personSec.set(r.profile_id, { name, sec: (prev?.sec ?? 0) + sec })
    }
    if (r.project_id) {
      const name = firstOf(r.project)?.name ?? 'Sin proyecto'
      const prev = projectSec.get(r.project_id)
      projectSec.set(r.project_id, { name, sec: (prev?.sec ?? 0) + sec })
    }
  }

  const toHours = (sec: number) => Math.round((sec / 3600) * 10) / 10
  const toRows = (m: Map<string, { name: string; sec: number }>): TimeRollupRow[] =>
    Array.from(m.entries())
      .map(([id, v]) => ({ id, name: v.name, hours: toHours(v.sec) }))
      .sort((a, b) => b.hours - a.hours)

  const timeRollup: TimeRollup = {
    totalHours: toHours(totalSec),
    entryCount: (timeRows ?? []).length,
    byPerson: toRows(personSec),
    byProject: toRows(projectSec),
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
        timeRollup={timeRollup}
        timeDays={TIME_DAYS}
        soloPropio={!ctx.isAdmin}
      />
    </div>
  )
}

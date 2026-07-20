/**
 * Configuración → Rendimiento.
 *
 * Tablero de evaluación (solo admin). Calcula, para el mes seleccionado, un
 * score 0-100 por persona a partir de tareas COMPLETADAS (tasks.completed_at
 * cae dentro del mes) y un desglose por CANAL/PROYECTO atribuido a su manager
 * (resuelve la visibilidad del Punto 3: cada quien ataca un proyecto distinto).
 *
 * Métricas y pesos (se renormalizan sobre las métricas disponibles por persona):
 *   - Throughput   25%  -> nº de tareas cerradas en el mes (relativo al top)
 *   - Velocity     30%  -> suma de story_points_done cerrados (relativo al top)
 *   - On-time      25%  -> % de tareas con due_date cerradas en fecha (absoluto)
 *   - Estimación   20%  -> precisión story_points vs story_points_done (absoluto)
 *
 * Throughput/Velocity son RELATIVOS al mejor del mes (normaliza esfuerzo entre
 * equipos con volúmenes distintos). On-time y Estimación son ABSOLUTOS 0-100.
 * Un asignado se cuenta desde tasks.assignee_id UNION task_assignees (multi).
 */
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { PerformancePanel } from './PerformancePanel'

export interface PersonScore {
  profileId: string
  name: string
  avatarUrl: string | null
  throughput: number
  velocity: number
  onTimePct: number | null
  estAccuracy: number | null
  score: number
}

export interface ChannelRow {
  projectId: string
  projectName: string
  icon: string | null
  teamName: string | null
  managerName: string | null
  managerAvatar: string | null
  tasksDone: number
  storyPoints: number
}

// ── Utilidades de mes ────────────────────────────────────────────────────────
function currentMonthStr(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function monthBounds(month: string): { start: Date; end: Date } {
  const [y, m] = month.split('-').map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 1))
  return { start, end }
}

export default async function PerformanceSettingsPage({
  params,
  searchParams,
}: {
  params: { workspaceSlug: string }
  searchParams: { month?: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')
  if (!ctx.isAdmin) redirect(`/w/${params.workspaceSlug}`)

  const month = /^\d{4}-\d{2}$/.test(searchParams.month ?? '')
    ? (searchParams.month as string)
    : currentMonthStr()
  const { start, end } = monthBounds(month)

  const admin = createAdminClient()
  const wsId = ctx.workspace.id

  // ── Proyectos del workspace (canales) ──────────────────────────────────────
  type ProjectRow = {
    id: string
    name: string
    icon: string | null
    team_id: string | null
    lead_id: string | null
  }
  const { data: projects } = (await admin
    .from('projects')
    .select('id, name, icon, team_id, lead_id')
    .eq('workspace_id', wsId)
    .eq('is_archived', false)) as { data: ProjectRow[] | null; error: unknown }

  // ── Equipos (para nombre de canal) ─────────────────────────────────────────
  const { data: teams } = (await admin
    .from('teams')
    .select('id, name')
    .eq('workspace_id', wsId)) as { data: { id: string; name: string }[] | null; error: unknown }
  const teamName = new Map((teams ?? []).map((t) => [t.id, t.name]))

  // ── Managers de proyecto (project_members.role='manager') como respaldo ─────
  const { data: pmembers } = (await admin
    .from('project_members')
    .select('project_id, profile_id, role')) as {
    data: { project_id: string; profile_id: string; role: string }[] | null
    error: unknown
  }
  const managerByProject = new Map<string, string>()
  for (const pm of pmembers ?? []) {
    if (pm.role === 'manager' && !managerByProject.has(pm.project_id)) {
      managerByProject.set(pm.project_id, pm.profile_id)
    }
  }

  // ── Tareas del workspace cerradas en el mes ────────────────────────────────
  type TaskRow = {
    id: string
    project_id: string | null
    assignee_id: string | null
    story_points: number | null
    story_points_done: number | null
    due_date: string | null
    completed_at: string | null
  }
  const { data: tasks } = (await admin
    .from('tasks')
    .select('id, project_id, assignee_id, story_points, story_points_done, due_date, completed_at')
    .eq('workspace_id', wsId)
    .eq('is_archived', false)
    .not('completed_at', 'is', null)
    .gte('completed_at', start.toISOString())
    .lt('completed_at', end.toISOString())) as { data: TaskRow[] | null; error: unknown }

  const doneTasks = tasks ?? []
  const doneTaskIds = doneTasks.map((t) => t.id)

  // ── Asignados adicionales (multi-asignación) ───────────────────────────────
  let extraAssignees: { task_id: string; profile_id: string }[] = []
  if (doneTaskIds.length > 0) {
    const { data: ta } = (await admin
      .from('task_assignees')
      .select('task_id, profile_id')
      .in('task_id', doneTaskIds)) as {
      data: { task_id: string; profile_id: string }[] | null
      error: unknown
    }
    extraAssignees = ta ?? []
  }
  const assigneesByTask = new Map<string, Set<string>>()
  for (const t of doneTasks) {
    const s = new Set<string>()
    if (t.assignee_id) s.add(t.assignee_id)
    assigneesByTask.set(t.id, s)
  }
  for (const a of extraAssignees) {
    assigneesByTask.get(a.task_id)?.add(a.profile_id)
  }

  // ── Perfiles del workspace (nombres/avatares) ──────────────────────────────
  const { data: wsMembers } = (await admin
    .from('workspace_members')
    .select('profile_id, profiles ( id, display_name, avatar_url )')
    .eq('workspace_id', wsId)) as {
    data:
      | { profile_id: string; profiles: { id: string; display_name: string; avatar_url: string | null } | null }[]
      | null
    error: unknown
  }
  const profileById = new Map<string, { name: string; avatar: string | null }>()
  for (const m of wsMembers ?? []) {
    if (m.profiles) {
      profileById.set(m.profiles.id, {
        name: m.profiles.display_name,
        avatar: m.profiles.avatar_url,
      })
    }
  }

  // ── Acumular métricas crudas por persona ───────────────────────────────────
  type Raw = {
    throughput: number
    velocity: number
    dueTotal: number
    dueOnTime: number
    estSum: number
    estCount: number
  }
  const raw = new Map<string, Raw>()
  const ensure = (id: string): Raw => {
    let r = raw.get(id)
    if (!r) {
      r = { throughput: 0, velocity: 0, dueTotal: 0, dueOnTime: 0, estSum: 0, estCount: 0 }
      raw.set(id, r)
    }
    return r
  }

  for (const t of doneTasks) {
    const assignees = assigneesByTask.get(t.id)
    if (!assignees || assignees.size === 0) continue
    const spDone = t.story_points_done ?? t.story_points ?? 0
    const onTime =
      t.due_date != null && t.completed_at != null
        ? new Date(t.completed_at) <= new Date(t.due_date)
        : null
    // Precisión de estimación: cercanía entre lo estimado y lo entregado.
    let est: number | null = null
    if (t.story_points != null && t.story_points_done != null) {
      const sp = t.story_points
      const spd = t.story_points_done
      const denom = Math.max(sp, spd)
      est = denom > 0 ? 1 - Math.abs(sp - spd) / denom : 1
    }
    for (const pid of assignees) {
      const r = ensure(pid)
      r.throughput += 1
      r.velocity += spDone
      if (onTime != null) {
        r.dueTotal += 1
        if (onTime) r.dueOnTime += 1
      }
      if (est != null) {
        r.estSum += est
        r.estCount += 1
      }
    }
  }

  // Máximos para normalización relativa
  let maxThroughput = 0
  let maxVelocity = 0
  for (const r of raw.values()) {
    if (r.throughput > maxThroughput) maxThroughput = r.throughput
    if (r.velocity > maxVelocity) maxVelocity = r.velocity
  }

  const W = { throughput: 0.25, velocity: 0.3, ontime: 0.25, est: 0.2 }

  const people: PersonScore[] = []
  for (const [pid, r] of raw.entries()) {
    const prof = profileById.get(pid)
    const throughputNorm = maxThroughput > 0 ? (r.throughput / maxThroughput) * 100 : 0
    const velocityNorm = maxVelocity > 0 ? (r.velocity / maxVelocity) * 100 : 0
    const onTimePct = r.dueTotal > 0 ? (r.dueOnTime / r.dueTotal) * 100 : null
    const estAccuracy = r.estCount > 0 ? (r.estSum / r.estCount) * 100 : null

    // Renormalizar pesos sobre métricas disponibles
    let wsum = W.throughput + W.velocity
    let acc = W.throughput * throughputNorm + W.velocity * velocityNorm
    if (onTimePct != null) {
      wsum += W.ontime
      acc += W.ontime * onTimePct
    }
    if (estAccuracy != null) {
      wsum += W.est
      acc += W.est * estAccuracy
    }
    const score = wsum > 0 ? acc / wsum : 0

    people.push({
      profileId: pid,
      name: prof?.name ?? 'Sin nombre',
      avatarUrl: prof?.avatar ?? null,
      throughput: r.throughput,
      velocity: r.velocity,
      onTimePct: onTimePct != null ? Math.round(onTimePct) : null,
      estAccuracy: estAccuracy != null ? Math.round(estAccuracy) : null,
      score: Math.round(score),
    })
  }
  people.sort((a, b) => b.score - a.score || b.throughput - a.throughput)

  // ── Desglose por canal/proyecto (atribuido al manager) ─────────────────────
  const doneByProject = new Map<string, { count: number; pts: number }>()
  for (const t of doneTasks) {
    if (!t.project_id) continue
    const agg = doneByProject.get(t.project_id) ?? { count: 0, pts: 0 }
    agg.count += 1
    agg.pts += t.story_points_done ?? t.story_points ?? 0
    doneByProject.set(t.project_id, agg)
  }

  const channels: ChannelRow[] = (projects ?? []).map((p) => {
    const managerId = p.lead_id ?? managerByProject.get(p.id) ?? null
    const mgr = managerId ? profileById.get(managerId) : null
    const agg = doneByProject.get(p.id) ?? { count: 0, pts: 0 }
    return {
      projectId: p.id,
      projectName: p.name,
      icon: p.icon,
      teamName: p.team_id ? teamName.get(p.team_id) ?? null : null,
      managerName: mgr?.name ?? null,
      managerAvatar: mgr?.avatar ?? null,
      tasksDone: agg.count,
      storyPoints: agg.pts,
    }
  })
  channels.sort((a, b) => b.tasksDone - a.tasksDone || a.projectName.localeCompare(b.projectName))

  return (
    <PerformancePanel
      workspaceSlug={params.workspaceSlug}
      month={month}
      people={people}
      channels={channels}
      totalDone={doneTasks.length}
    />
  )
}

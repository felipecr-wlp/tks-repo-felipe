/**
 * Progreso de un proyecto = tareas cerradas / tareas totales (no archivadas).
 *
 * "Cerrada" = su status pertenece a la categoria 'done' (taxonomia de
 * task_statuses: todo / in_progress / done / cancelled). Las 'cancelled' NO
 * cuentan como cerradas ni inflan el total: se ignoran para que el 100% refleje
 * trabajo realmente entregado. El proyecto solo puede marcarse "completado"
 * cuando pct === 100 (y hay al menos una tarea).
 *
 * Se usa admin client (service_role) porque los callers ya verificaron autoridad.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

export type ProjectProgress = { total: number; done: number; pct: number }

export async function computeProjectProgress(admin: Admin, projectId: string): Promise<ProjectProgress> {
  const { data: doneStatuses } = await admin
    .from('task_statuses')
    .select('id')
    .eq('project_id', projectId)
    .eq('category', 'done') as { data: { id: string }[] | null }
  const doneIds = (doneStatuses ?? []).map((s: { id: string }) => s.id)

  const { data: cancelledStatuses } = await admin
    .from('task_statuses')
    .select('id')
    .eq('project_id', projectId)
    .eq('category', 'cancelled') as { data: { id: string }[] | null }
  const cancelledIds = (cancelledStatuses ?? []).map((s: { id: string }) => s.id)

  // Total = tareas no archivadas y no canceladas.
  let totalQuery = admin
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('is_archived', false)
  if (cancelledIds.length > 0) {
    totalQuery = totalQuery.not('status_id', 'in', `(${cancelledIds.join(',')})`)
  }
  const { count: total } = await totalQuery as { count: number | null }

  let done = 0
  if (doneIds.length > 0) {
    const { count } = await admin
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('is_archived', false)
      .in('status_id', doneIds) as { count: number | null }
    done = count ?? 0
  }

  const t = total ?? 0
  return { total: t, done, pct: t === 0 ? 0 : Math.round((done / t) * 100) }
}

/**
 * Version batch: progreso de MUCHOS proyectos con solo 2 consultas totales
 * (en vez de ~4 por proyecto). Evita el N+1 de la pantalla de Proyectos, donde
 * un usuario en 15 proyectos disparaba ~60 round trips secuenciales.
 *
 * Regla identica a computeProjectProgress: 'cancelled' no cuenta ni al total ni
 * a done; 'done' cuenta como cerrada. Se agrega en memoria.
 */
export async function computeProjectsProgress(
  admin: Admin,
  projectIds: string[],
): Promise<Map<string, ProjectProgress>> {
  const result = new Map<string, ProjectProgress>()
  const ids = Array.from(new Set(projectIds)).filter(Boolean)
  if (ids.length === 0) return result
  for (const id of ids) result.set(id, { total: 0, done: 0, pct: 0 })

  // 1) Categoria de cada status de estos proyectos.
  const { data: statuses } = await admin
    .from('task_statuses')
    .select('id, project_id, category')
    .in('project_id', ids) as { data: { id: string; project_id: string; category: string }[] | null }

  const doneStatusIds = new Set<string>()
  const cancelledStatusIds = new Set<string>()
  for (const s of statuses ?? []) {
    if (s.category === 'done') doneStatusIds.add(s.id)
    else if (s.category === 'cancelled') cancelledStatusIds.add(s.id)
  }

  // 2) Tareas no archivadas de todos los proyectos, solo columnas necesarias.
  const { data: tasks } = await admin
    .from('tasks')
    .select('project_id, status_id')
    .in('project_id', ids)
    .eq('is_archived', false) as { data: { project_id: string; status_id: string | null }[] | null }

  const agg = new Map<string, { total: number; done: number }>()
  for (const id of ids) agg.set(id, { total: 0, done: 0 })
  for (const task of tasks ?? []) {
    const bucket = agg.get(task.project_id)
    if (!bucket) continue
    if (task.status_id && cancelledStatusIds.has(task.status_id)) continue // canceladas no cuentan
    bucket.total += 1
    if (task.status_id && doneStatusIds.has(task.status_id)) bucket.done += 1
  }

  for (const [id, { total, done }] of agg) {
    result.set(id, { total, done, pct: total === 0 ? 0 : Math.round((done / total) * 100) })
  }
  return result
}

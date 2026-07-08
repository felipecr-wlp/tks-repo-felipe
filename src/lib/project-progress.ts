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

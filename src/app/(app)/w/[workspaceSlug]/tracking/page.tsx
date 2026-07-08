/**
 * Seguimiento de tiempo (timesheet personal).
 *
 * Server component: resuelve el workspace por membresia (anti-RLS-loop) y con el
 * admin client trae las entradas propias de los ultimos dias (suficiente para las
 * vistas "Hoy" y "Esta semana", que el cliente agrupa en hora local), el timer
 * activo y las tareas asignadas del usuario (para el alta manual).
 *
 * Un usuario solo ve SUS entradas. Editar/borrar tambien es solo del dueño (API).
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { TrackingClient, type TimeEntry, type TrackTaskOption } from './TrackingClient'

interface PageProps {
  params: { workspaceSlug: string }
}

export default async function TrackingPage({ params }: PageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // ── Workspace desde membresia ──────────────────────────────────────────────
  type WsFromMember = { workspaces: { id: string; name: string } | null }
  const { data: row } = await admin
    .from('workspace_members')
    .select('workspaces!inner ( id, name )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle() as { data: WsFromMember | null; error: unknown }

  const workspace = row?.workspaces
  if (!workspace) redirect('/')

  // ── Entradas de los ultimos 10 dias (cubre "hoy" y "semana" en cualquier tz) ─
  const since = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
  const { data: entriesRaw } = await admin
    .from('time_entries')
    .select(`
      id, task_id, project_id, started_at, ended_at, duration_sec, note,
      task:tasks ( id, title ),
      project:projects ( id, name )
    `)
    .eq('profile_id', user.id)
    .eq('workspace_id', workspace.id)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(500) as { data: TimeEntry[] | null; error: unknown }

  const entries = entriesRaw ?? []
  const running = entries.find(e => e.ended_at === null) ?? null

  // ── Tareas asignadas al usuario (para el selector de alta manual) ───────────
  type TaskRow = { id: string; title: string; project: { name: string } | null }
  const { data: taskRows } = await admin
    .from('tasks')
    .select('id, title, project:projects ( name )')
    .eq('workspace_id', workspace.id)
    .eq('assignee_id', user.id)
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })
    .limit(100) as { data: TaskRow[] | null; error: unknown }

  const taskOptions: TrackTaskOption[] = (taskRows ?? []).map(t => ({
    id: t.id,
    title: t.title,
    project_name: t.project?.name ?? null,
  }))

  return (
    <TrackingClient
      workspaceName={workspace.name}
      entries={entries}
      running={running}
      taskOptions={taskOptions}
    />
  )
}

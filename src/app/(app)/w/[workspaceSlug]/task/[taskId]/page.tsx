/**
 * Resolutor de deep-link a una tarea (B17).
 * La bandeja (inbox) sólo conoce el id de la tarea, no la ruta del proyecto.
 * Esta página server-side resuelve tarea -> proyecto -> equipo y redirige al
 * tablero del proyecto con ?task=<id>, que abre el TaskDetailPanel al montar.
 */
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'

interface TaskRedirectPageProps {
  params: { workspaceSlug: string; taskId: string }
}

export default async function TaskRedirectPage({ params }: TaskRedirectPageProps) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // Resolver la tarea y su proyecto/equipo (una sola consulta con joins).
  type TaskResolve = {
    id: string
    project: {
      slug: string
      team: { slug: string } | null
    } | null
  }
  const { data: task } = await admin
    .from('tasks')
    .select('id, project:projects ( slug, team:teams ( slug ) )')
    .eq('id', params.taskId)
    .maybeSingle() as { data: TaskResolve | null; error: unknown }

  const projectSlug = task?.project?.slug
  const teamSlug = task?.project?.team?.slug
  if (!task || !projectSlug || !teamSlug) notFound()

  // Verificar que el usuario sea miembro del proyecto antes de redirigir.
  const { data: membership } = await admin
    .from('project_members')
    .select('role, projects!inner ( slug )')
    .eq('profile_id', user.id)
    .eq('projects.slug', projectSlug)
    .limit(1)
    .maybeSingle() as { data: { role: string } | null; error: unknown }

  if (!membership) notFound()

  redirect(
    `/w/${params.workspaceSlug}/t/${teamSlug}/p/${projectSlug}?view=board&task=${params.taskId}`
  )
}

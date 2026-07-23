/**
 * Configuración → Academia. Panel de gestion (solo admin):
 *   - Solicitudes de acceso pendientes (aprobar / rechazar).
 *   - Matriz: quien tiene acceso a que y quien esta certificado.
 *   - Asignacion directa de acceso por persona y curso.
 */
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { listPendingRequests, listAccessMatrix } from '@/lib/academy/data'
import { COURSES, PROFILES } from '@/lib/academy/courses'
import { AcademyAdminPanel } from './AcademyAdminPanel'

export default async function AcademiaSettingsPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')
  if (!ctx.isAdmin) redirect(`/w/${params.workspaceSlug}`)

  const admin = createAdminClient()

  type WsMemberRow = {
    profile_id: string
    profiles: { id: string; display_name: string | null; email: string | null; avatar_url: string | null } | null
  }
  const [pending, matrix, { data: wsMembers }] = await Promise.all([
    listPendingRequests(),
    listAccessMatrix(),
    // El join profiles infiere una forma (arreglo) distinta a WsMemberRow.
    admin
      .from('workspace_members')
      .select('profile_id, profiles ( id, display_name, email, avatar_url )')
      .eq('workspace_id', ctx.workspace.id) as unknown as Promise<{ data: WsMemberRow[] | null }>,
  ])

  const members = (wsMembers ?? [])
    .map((m) => ({
      id: m.profile_id,
      display_name: m.profiles?.display_name ?? 'Usuario',
      email: m.profiles?.email ?? '',
      avatar_url: m.profiles?.avatar_url ?? null,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name))

  const courses = COURSES.map((c) => ({ id: c.id, title: c.title, track: c.track }))
  const allCourseIds = COURSES.map((c) => c.id)

  // Presets por rol: resuelve los bundles de PROFILES ("*" = todos los cursos)
  // y descarta cursos que ya no existan, para que el panel asigne por rol de un clic.
  const presets = Object.entries(PROFILES).map(([key, def]) => ({
    key,
    label: def.label,
    courseIds:
      def.courses === '*'
        ? allCourseIds
        : def.courses.filter((id) => allCourseIds.includes(id)),
  }))

  return (
    <AcademyAdminPanel
      workspaceId={ctx.workspace.id}
      pending={pending.map((p) => ({
        id: p.id,
        courseId: p.course_id,
        note: p.note,
        createdAt: p.created_at,
        profile: p.profile,
      }))}
      matrix={matrix}
      members={members}
      courses={courses}
      presets={presets}
    />
  )
}

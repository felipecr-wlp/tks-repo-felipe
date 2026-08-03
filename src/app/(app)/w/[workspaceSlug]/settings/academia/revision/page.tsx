/**
 * Configuración → Academia → Revisión de cursos del equipo.
 *
 * POR QUE UNA PANTALLA APARTE Y NO UNA SECCION MAS DEL PANEL DE ACCESOS.
 * Conceder acceso a un curso afecta a UNA persona y se deshace con un clic.
 * Publicar un curso lo pone delante de toda la organización con el nombre de
 * quien lo escribió encima. Son decisiones de peso distinto y la pantalla que
 * las presenta juntas las hace parecer del mismo tamaño.
 *
 * Se cargan los pendientes Y los ya publicados: sin lo publicado a la vista, la
 * única forma de corregir un curso vivo sería adivinar su id.
 */
import { redirect } from 'next/navigation'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { listarCursosDeEquipoParaAdmin, normalizarModulos } from '@/lib/academy/catalog'
import { RevisionCursos } from './RevisionCursos'

export default async function RevisionCursosPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')
  if (!ctx.isAdmin) redirect(`/w/${params.workspaceSlug}`)

  const cursos = await listarCursosDeEquipoParaAdmin(['pending_review', 'published', 'rejected'])

  return (
    <RevisionCursos
      workspaceId={ctx.workspace.id}
      yoId={ctx.userId}
      cursos={cursos.map((c) => ({
        id: c.id,
        courseId: c.course_id,
        authorId: c.author_id,
        status: c.status,
        title: c.title,
        subtitle: c.subtitle,
        track: c.track,
        icon: c.icon,
        accent: c.accent,
        reviewNote: c.review_note,
        submittedAt: c.submitted_at,
        updatedAt: c.updated_at,
        autor: c.autor
          ? {
              nombre: c.autor.display_name || c.autor.email || 'Alguien del equipo',
              avatar: c.autor.avatar_url,
            }
          : null,
        modules: normalizarModulos(c.modules),
      }))}
    />
  )
}

/**
 * Editor de un curso propio.
 *
 * Solo se entra a lo que se puede editar. Un curso PUBLICADO o EN REVISION no
 * abre el editor: se manda de vuelta a la lista. No es un capricho de interfaz,
 * es la misma regla que aplica el API. Si la pantalla dejara escribir y el API
 * rechazara al guardar, la persona perderia el trabajo que ya hizo.
 */
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { isUuid } from '@/lib/validation'
import { normalizarModulos, type CursoEquipoRow } from '@/lib/academy/catalog'
import { EditorCurso } from './EditorCurso'

export default async function EditorCursoPage({
  params,
}: {
  params: { workspaceSlug: string; id: string }
}) {
  if (!isUuid(params.id)) redirect(`/w/${params.workspaceSlug}/academia/mis-cursos`)

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()
  type WsRow = { workspaces: { id: string } | null }
  const { data: ws } = (await admin
    .from('workspace_members')
    .select('workspaces!inner ( id )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle()) as { data: WsRow | null }
  if (!ws?.workspaces) redirect('/')

  const { data: curso } = (await admin
    .from('academy_custom_courses')
    .select(
      'id, course_id, author_id, status, title, subtitle, track, icon, accent, lang, cert_name, modules, review_note',
    )
    .eq('id', params.id)
    .maybeSingle()) as { data: CursoEquipoRow | null }

  const volver = `/w/${params.workspaceSlug}/academia/mis-cursos`
  if (!curso) redirect(volver)
  // Un curso ajeno no se edita, ni siendo admin: diria "escrito por X" con texto
  // que X no escribio.
  if (curso.author_id !== user.id) redirect(volver)
  if (curso.status !== 'draft' && curso.status !== 'rejected') redirect(volver)

  return (
    <EditorCurso
      workspaceSlug={params.workspaceSlug}
      workspaceId={ws.workspaces.id}
      cursoId={curso.id}
      courseId={curso.course_id}
      estado={curso.status}
      reviewNote={curso.review_note}
      inicial={{
        title: curso.title,
        subtitle: curso.subtitle,
        track: curso.track,
        icon: curso.icon,
        accent: curso.accent,
        lang: curso.lang,
        certName: curso.cert_name,
        modules: normalizarModulos(curso.modules),
      }}
    />
  )
}

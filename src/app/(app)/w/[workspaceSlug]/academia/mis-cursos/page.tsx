/**
 * Academia -> Mis cursos. Lo que YO escribi, en cualquier estado.
 *
 * Es una pagina aparte de la biblioteca a proposito. En la biblioteca un curso
 * es algo que se estudia; aqui es algo que se esta escribiendo, con estados que
 * al lector no le importan (borrador, en revision, devuelto). Mezclarlos haria
 * que la biblioteca mostrara cosas a medio hacer.
 */
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { listarCursosDeAutor } from '@/lib/academy/catalog'
import { MisCursos } from './MisCursos'

export default async function MisCursosPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  // Membresia por slug: sin esto, el slug de otro workspace serviria de puerta.
  const admin = createAdminClient()
  type WsRow = { workspaces: { id: string } | null }
  const { data: row } = (await admin
    .from('workspace_members')
    .select('workspaces!inner ( id )')
    .eq('profile_id', user.id)
    .eq('workspaces.slug', params.workspaceSlug)
    .limit(1)
    .maybeSingle()) as { data: WsRow | null }
  if (!row?.workspaces) redirect('/')

  const cursos = await listarCursosDeAutor(user.id)

  return (
    <MisCursos
      workspaceSlug={params.workspaceSlug}
      workspaceId={row.workspaces.id}
      cursos={cursos.map((c) => ({
        id: c.id,
        courseId: c.course_id,
        status: c.status,
        title: c.title,
        subtitle: c.subtitle,
        icon: c.icon,
        accent: c.accent,
        track: c.track,
        modulos: Array.isArray(c.modules) ? c.modules.length : 0,
        reviewNote: c.review_note,
        updatedAt: c.updated_at,
      }))}
    />
  )
}

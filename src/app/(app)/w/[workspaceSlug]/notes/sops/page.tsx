/**
 * /w/[slug]/notes/sops, lente "Procesos y SOPs".
 * Vista transversal de todos los documentos operativos (doc_kind <> 'note') del
 * workspace. Hereda el layout de notas (arbol a la izquierda). Ruta estatica:
 * gana sobre notes/[noteId].
 */
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { SopsLens, type SopRow } from './SopsLens'
import { loadNoteViewerContext, canViewNote, noteVisibilityPrefilter } from '@/lib/note-visibility'

interface SopsPageProps {
  params: { workspaceSlug: string }
}

export const metadata = { title: 'Procesos y SOPs · WLO' }

type RawSop = {
  id: string
  title: string
  icon: string | null
  doc_kind: SopRow['doc_kind']
  sop_status: SopRow['sop_status']
  sop_version: string | null
  review_due: string | null
  updated_at: string
  visibility: string
  created_by: string | null
  space_id: string | null
  project_id: string | null
  author: { display_name: string | null } | null
}

type SpaceRow = { id: string; name: string; color: string | null; is_restricted: boolean }

export default async function SopsPage({ params }: SopsPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

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

  // Documentos operativos del workspace.
  const { data: rawSops } = await admin
    .from('notes')
    .select(`
      id, title, icon, doc_kind, sop_status, sop_version, review_due,
      updated_at, visibility, created_by, space_id, project_id,
      author:profiles ( display_name )
    `)
    .eq('workspace_id', workspace.id)
    .neq('doc_kind', 'note')
    // Privadas ajenas fuera en la consulta (antes del limit), para no gastar
    // slots del tope con documentos que igual se ocultarian. El gating de
    // departamentos restringidos si queda en JS: depende de las membresias que
    // se calculan mas abajo.
    .or(noteVisibilityPrefilter(user.id))
    .order('updated_at', { ascending: false })
    .limit(500) as { data: RawSop[] | null; error: unknown }

  const { data: rawSpaces } = await admin
    .from('spaces')
    .select('id, name, color, is_restricted')
    .eq('workspace_id', workspace.id) as { data: SpaceRow[] | null; error: unknown }

  const spaceById = new Map((rawSpaces ?? []).map(s => [s.id, s]))

  // Modelo de visibilidad completo (privada = solo autor, space/team = su
  // departamento, project = su proyecto, workspace = la empresa) mas el
  // aislamiento de departamentos restringidos.
  const noteCtx = await loadNoteViewerContext(admin, workspace.id, user.id)

  const sops: SopRow[] = (rawSops ?? [])
    .filter(n => canViewNote(noteCtx, n))
    .map(n => {
      const sp = n.space_id ? spaceById.get(n.space_id) : null
      return {
        id: n.id,
        title: n.title,
        icon: n.icon,
        doc_kind: n.doc_kind,
        sop_status: n.sop_status,
        sop_version: n.sop_version,
        review_due: n.review_due,
        updated_at: n.updated_at,
        space: sp ? { id: sp.id, name: sp.name, color: sp.color } : null,
        author: n.author,
      }
    })

  return <SopsLens sops={sops} workspaceSlug={params.workspaceSlug} workspaceId={workspace.id} />
}

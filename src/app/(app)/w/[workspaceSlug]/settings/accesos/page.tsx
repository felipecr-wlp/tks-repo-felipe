/**
 * Configuración -> Accesos. UN solo lugar para responder las dos preguntas que
 * la gente hace de verdad: "¿qué ve esta persona?" y "¿quién ve esto?".
 *
 * Por qué existe y por qué es una sola pantalla:
 *   El sistema tiene TRES niveles y ni uno más (privada / departamento / toda la
 *   empresa). Lo único que decide quién ve qué es a qué DEPARTAMENTO pertenece
 *   cada quien. Entonces este panel no inventa permisos nuevos ni roles nuevos:
 *   dibuja esa única palanca como una cuadrícula de personas contra
 *   departamentos, y al lado dice cuántos documentos alcanza cada persona con
 *   los departamentos que tiene. Un clic mueve a alguien de departamento y el
 *   número de al lado cambia. Eso es todo el control de acceso.
 *
 * El cálculo de "cuánto ve cada quien" se hace EN MEMORIA: se traen una vez las
 * membresías y los documentos del workspace y se evalúa el mismo predicado que
 * usa la app (`canViewNote`), en vez de 4 queries por persona.
 */
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/server'
import { getWorkspaceAdminContext } from '@/lib/workspace-admin'
import { canViewNote, type NoteViewerContext, type NoteVisibilityScope } from '@/lib/note-visibility'
import { AccessMatrix, type AccessPerson, type AccessSpace } from './AccessMatrix'

export default async function AccessSettingsPage({
  params,
}: {
  params: { workspaceSlug: string }
}) {
  const ctx = await getWorkspaceAdminContext(params.workspaceSlug)
  if (!ctx) redirect('/auth/login')
  if (!ctx.isAdmin) redirect(`/w/${params.workspaceSlug}`)

  const admin = createAdminClient()
  const workspaceId = ctx.workspace.id

  type WsMemberRow = {
    profile_id: string
    profiles: {
      id: string
      display_name: string | null
      email: string | null
      avatar_url: string | null
      org_role: string | null
    } | null
  }
  type SpaceRow = { id: string; name: string; is_restricted: boolean }
  type BoardScope = NoteVisibilityScope & { id: string; note_id: string | null }

  const [membersRes, spacesRes, projectsRes, notesRes, boardsRes] = await Promise.all([
    admin.from('workspace_members')
      .select('profile_id, profiles ( id, display_name, email, avatar_url, org_role )')
      .eq('workspace_id', workspaceId),
    admin.from('spaces')
      .select('id, name, is_restricted')
      .eq('workspace_id', workspaceId).eq('is_archived', false)
      .order('name', { ascending: true }),
    admin.from('projects').select('id').eq('workspace_id', workspaceId),
    admin.from('notes')
      .select('id, visibility, space_id, project_id, created_by')
      .eq('workspace_id', workspaceId),
    admin.from('whiteboards')
      .select('id, visibility, space_id, project_id, created_by, note_id')
      .eq('workspace_id', workspaceId),
  ])

  const spaces = ((spacesRes.data ?? []) as SpaceRow[])
  const spaceIdSet = new Set(spaces.map(s => s.id))
  const restrictedIds = spaces.filter(s => s.is_restricted).map(s => s.id)
  const projectIdsOfWs = new Set(((projectsRes.data ?? []) as { id: string }[]).map(p => p.id))

  // Membresías de departamento y de proyecto, agrupadas por persona en una sola
  // pasada. Se acotan a este workspace para no contar lo de otro espacio.
  const [spaceMemRes, projectMemRes] = await Promise.all([
    spaceIdSet.size
      ? admin.from('space_members').select('space_id, profile_id').in('space_id', [...spaceIdSet])
      : Promise.resolve({ data: [] as { space_id: string; profile_id: string }[] }),
    projectIdsOfWs.size
      ? admin.from('project_members').select('project_id, profile_id').in('project_id', [...projectIdsOfWs])
      : Promise.resolve({ data: [] as { project_id: string; profile_id: string }[] }),
  ])

  const spacesByPerson = new Map<string, Set<string>>()
  for (const r of (spaceMemRes.data ?? []) as { space_id: string; profile_id: string }[]) {
    if (!spacesByPerson.has(r.profile_id)) spacesByPerson.set(r.profile_id, new Set())
    spacesByPerson.get(r.profile_id)!.add(r.space_id)
  }
  const projectsByPerson = new Map<string, Set<string>>()
  for (const r of (projectMemRes.data ?? []) as { project_id: string; profile_id: string }[]) {
    if (!projectsByPerson.has(r.profile_id)) projectsByPerson.set(r.profile_id, new Set())
    projectsByPerson.get(r.profile_id)!.add(r.project_id)
  }

  const notes = (notesRes.data ?? []) as NoteVisibilityScope[]
  const boards = (boardsRes.data ?? []) as BoardScope[]
  const notesById = new Map<string, NoteVisibilityScope>()
  for (const n of (notesRes.data ?? []) as (NoteVisibilityScope & { id: string })[]) {
    notesById.set(n.id, n)
  }

  const people: AccessPerson[] = ((membersRes.data ?? []) as WsMemberRow[])
    .map(m => {
      const id = m.profile_id
      const orgRole = m.profiles?.org_role ?? 'member'
      const isOrgAdmin = orgRole === 'owner' || orgRole === 'admin'
      const mySpaces = spacesByPerson.get(id) ?? new Set<string>()

      const viewer: NoteViewerContext = {
        userId: id,
        isOrgAdmin,
        spaceIds: mySpaces,
        projectIds: projectsByPerson.get(id) ?? new Set<string>(),
        // Un departamento restringido al que NO pertenece queda bloqueado.
        blockedSpaceIds: new Set(
          restrictedIds.filter(sid => !isOrgAdmin && !mySpaces.has(sid))
        ),
      }

      const notesSeen = notes.filter(n => canViewNote(viewer, n)).length
      // Una pizarra incrustada hereda el alcance de su nota, igual que en la app.
      const boardsSeen = boards.filter(b =>
        canViewNote(viewer, b.note_id ? (notesById.get(b.note_id) ?? b) : b)
      ).length

      return {
        id,
        name: m.profiles?.display_name ?? 'Usuario',
        email: m.profiles?.email ?? '',
        avatar_url: m.profiles?.avatar_url ?? null,
        isOrgAdmin,
        spaceIds: [...mySpaces].filter(s => spaceIdSet.has(s)),
        notesSeen,
        boardsSeen,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const spaceCards: AccessSpace[] = spaces.map(s => ({
    id: s.id,
    name: s.name,
    is_restricted: s.is_restricted,
  }))

  return (
    <AccessMatrix
      people={people}
      spaces={spaceCards}
      totalNotes={notes.length}
      totalBoards={boards.length}
      workspaceSlug={params.workspaceSlug}
    />
  )
}

/**
 * Modelo de VISIBILIDAD de notas y documentos. Fuente unica de verdad.
 *
 * Regla de negocio (Ali, 2026-07-28):
 *   1. Una nota nace PRIVADA. Solo su autor la ve.
 *   2. Compartirla NO la abre a todo el mundo: la abre al DEPARTAMENTO.
 *   3. Abrirla a la empresa entera existe, pero es acto de mando: solo lo hace
 *      quien puede publicar comunicados (admin de org, admin de workspace o
 *      lead de equipo). Es lo que sostiene los SOPs, que por diseño alcanzan a
 *      todos y se acusan de recibido.
 *
 * Valores de `notes.visibility`:
 *   - 'private'    solo el autor (y admin de organizacion).
 *   - 'space'      miembros del departamento de la nota (`notes.space_id`).
 *   - 'team'       alias historico de 'space'. Se trata igual.
 *   - 'project'    miembros del proyecto de la nota (`notes.project_id`).
 *   - 'workspace'  toda la empresa. Requiere permiso de mando para asignarse.
 *
 * Ojo: una nota compartida al departamento SIN `space_id` no tiene a quien
 * abrirse, asi que se comporta como privada. La API lo impide al escribir; este
 * modulo lo vuelve a cerrar al leer, que es donde importa.
 *
 * Todas las rutas leen con `createAdminClient()` (service-role, bypassa RLS),
 * asi que la regla vive AQUI y la policy de la base es la red de abajo. Usar
 * `loadNoteViewerContext` una vez por request y `canViewNote` por fila.
 */
import type { createAdminClient } from '@/lib/supabase/server'

export const NOTE_VISIBILITY_VALUES = ['private', 'space', 'team', 'project', 'workspace'] as const
export type NoteVisibility = (typeof NOTE_VISIBILITY_VALUES)[number]

/** Toda nota nace privada. */
export const NOTE_VISIBILITY_DEFAULT: NoteVisibility = 'private'

/** Los campos minimos que hay que traer de una nota para poder decidir. */
export interface NoteVisibilityScope {
  visibility: string | null
  space_id?: string | null
  project_id?: string | null
  created_by?: string | null
}

export interface NoteViewerContext {
  userId: string
  isOrgAdmin: boolean
  /** Departamentos donde el usuario es miembro. */
  spaceIds: Set<string>
  /** Proyectos donde el usuario es miembro. */
  projectIds: Set<string>
  /** Departamentos restringidos del workspace que este usuario NO puede ver. */
  blockedSpaceIds: Set<string>
}

/**
 * Resuelve, en 4 queries fijas, todo lo que hace falta para decidir la
 * visibilidad de cualquier cantidad de notas de un workspace. Sin N+1.
 */
export async function loadNoteViewerContext(
  admin: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  userId: string,
): Promise<NoteViewerContext> {
  const [profRes, spaceRes, projectRes, restrictedRes] = await Promise.all([
    admin.from('profiles').select('org_role').eq('id', userId).maybeSingle(),
    admin.from('space_members').select('space_id').eq('profile_id', userId),
    admin.from('project_members').select('project_id').eq('profile_id', userId),
    admin.from('spaces').select('id').eq('workspace_id', workspaceId).eq('is_restricted', true),
  ])

  const orgRole = (profRes.data as { org_role: string | null } | null)?.org_role ?? 'member'
  const isOrgAdmin = orgRole === 'owner' || orgRole === 'admin'

  const spaceIds = new Set(
    ((spaceRes.data ?? []) as { space_id: string }[]).map(s => s.space_id)
  )
  const projectIds = new Set(
    ((projectRes.data ?? []) as { project_id: string }[]).map(p => p.project_id)
  )
  const blockedSpaceIds = new Set(
    ((restrictedRes.data ?? []) as { id: string }[])
      .filter(s => !isOrgAdmin && !spaceIds.has(s.id))
      .map(s => s.id)
  )

  return { userId, isOrgAdmin, spaceIds, projectIds, blockedSpaceIds }
}

/**
 * ¿Puede este usuario VER esta nota? Combina el aislamiento de departamentos
 * restringidos (F3) con el modelo de visibilidad nuevo. Ambos tienen que dar
 * verde: un departamento restringido bloquea incluso una nota 'workspace'.
 */
export function canViewNote(ctx: NoteViewerContext, note: NoteVisibilityScope): boolean {
  // Aislamiento de departamento restringido: manda sobre todo lo demas.
  if (note.space_id && ctx.blockedSpaceIds.has(note.space_id)) return false

  if (ctx.isOrgAdmin) return true
  if (note.created_by && note.created_by === ctx.userId) return true

  switch (note.visibility) {
    case 'private':
      return false
    case 'workspace':
      return true
    case 'project':
      return !!note.project_id && ctx.projectIds.has(note.project_id)
    // 'space', 'team' y cualquier valor futuro: alcance departamento.
    default:
      return !!note.space_id && ctx.spaceIds.has(note.space_id)
  }
}

/**
 * Filtro PostgREST para descartar en la BASE lo que seguro no se va a ver, y no
 * gastar los slots del `.limit()` en filas que igual se ocultarian. Es una
 * aproximacion optimista a proposito: deja pasar de mas y `canViewNote` remata.
 */
export function noteVisibilityPrefilter(userId: string): string {
  return `visibility.neq.private,visibility.is.null,created_by.eq.${userId}`
}

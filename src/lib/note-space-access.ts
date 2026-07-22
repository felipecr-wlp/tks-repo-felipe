/**
 * Chequeo compartido de acceso a espacios restringidos (departamentos como RH,
 * Legal, Finanzas marcados `is_restricted` en la tabla `spaces`).
 *
 * Todas las rutas de notas usan `createAdminClient()` (service-role, bypassa
 * RLS), asi que la policy RESTRICTIVE `notes_restrict_space` de la migracion
 * `20260718130000_spaces_restricted_notes.sql` NO aplica ahi. Este helper
 * replica esa regla en la capa de API: solo admin de la organizacion o
 * miembro del espacio puede ver/editar/comentar/aprobar una nota cuyo
 * `space_id` apunte a un espacio restringido.
 *
 * Usar SIEMPRE que se cargue una nota por su id (GET/PATCH/DELETE y cualquier
 * sub-recurso: comentarios, versiones, acuses, menciones, backlinks, etc), no
 * solo en la ruta principal de la nota.
 */
import type { createAdminClient } from '@/lib/supabase/server'

export async function canAccessNoteSpace(
  admin: ReturnType<typeof createAdminClient>,
  spaceId: string | null | undefined,
  userId: string,
): Promise<boolean> {
  if (!spaceId) return true

  const { data: space } = await admin
    .from('spaces')
    .select('is_restricted')
    .eq('id', spaceId)
    .maybeSingle() as { data: { is_restricted: boolean } | null; error: unknown }

  if (!space?.is_restricted) return true

  const { data: prof } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle() as { data: { org_role: string | null } | null; error: unknown }

  if (prof?.org_role === 'owner' || prof?.org_role === 'admin') return true

  const { data: spaceMember } = await admin
    .from('space_members')
    .select('profile_id')
    .eq('space_id', spaceId)
    .eq('profile_id', userId)
    .maybeSingle() as { data: { profile_id: string } | null; error: unknown }

  return !!spaceMember
}

/**
 * Version batch del chequeo anterior para cuando hay que decidir el acceso a
 * MUCHOS espacios de una sola nota-lista (ej. backlinks, listados). Evita el
 * N+1 de llamar `canAccessNoteSpace` por elemento: resuelve todo en 3 queries
 * como maximo (spaces, profiles, space_members) sin importar cuantos ids entren.
 *
 * Devuelve un Set con los space_id a los que `userId` SI puede acceder. Un
 * space_id null nunca entra al Set (el llamador lo trata como accesible por su
 * cuenta, igual que en `canAccessNoteSpace`).
 */
export async function accessibleSpaceIds(
  admin: ReturnType<typeof createAdminClient>,
  spaceIds: (string | null | undefined)[],
  userId: string,
): Promise<Set<string>> {
  const ids = Array.from(new Set(spaceIds.filter((s): s is string => !!s)))
  const ok = new Set<string>()
  if (ids.length === 0) return ok

  const { data: spaces } = await admin
    .from('spaces')
    .select('id, is_restricted')
    .in('id', ids) as { data: { id: string; is_restricted: boolean }[] | null; error: unknown }

  const restricted = new Set<string>()
  for (const s of spaces ?? []) {
    if (s.is_restricted) restricted.add(s.id)
    else ok.add(s.id) // no restringido: accesible para cualquier miembro
  }
  if (restricted.size === 0) return ok

  const { data: prof } = await admin
    .from('profiles')
    .select('org_role')
    .eq('id', userId)
    .maybeSingle() as { data: { org_role: string | null } | null; error: unknown }

  if (prof?.org_role === 'owner' || prof?.org_role === 'admin') {
    for (const id of restricted) ok.add(id)
    return ok
  }

  const { data: memberships } = await admin
    .from('space_members')
    .select('space_id')
    .eq('profile_id', userId)
    .in('space_id', Array.from(restricted)) as { data: { space_id: string }[] | null; error: unknown }

  for (const m of memberships ?? []) ok.add(m.space_id)
  return ok
}

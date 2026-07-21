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

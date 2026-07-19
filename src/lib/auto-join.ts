/**
 * Auto-join por dominio de correo.
 *
 * Problema que resuelve: un usuario que se registra SIN invitacion caia en
 * /onboarding y creaba una organizacion nueva, quedando aislado en un workspace
 * propio (ya paso 2 veces: dos "General", + Alan Ambriz invisible). El unico
 * camino correcto de alta era la invitacion.
 *
 * Fix: si el dominio del correo del usuario mapea a una organizacion que declara
 * su workspace por defecto (organizations.email_domain + default_workspace_id),
 * lo unimos automaticamente a esa org + workspace con rol member, en lugar de
 * mandarlo a crear una org nueva.
 *
 * Idempotente: si el usuario ya tiene org, o si no hay match de dominio, no hace
 * nada y devuelve null. Se puede llamar en cada carga de la raiz / onboarding.
 */
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

interface AutoJoinUser {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
}

/**
 * Intenta unir al usuario a la org de su dominio. Devuelve el slug del workspace
 * al que se unio (para redirigir), o null si no aplica.
 */
export async function attemptDomainAutoJoin(
  admin: Admin,
  user: AutoJoinUser
): Promise<string | null> {
  const email = user.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) return null
  const domain = email.split('@')[1]
  if (!domain) return null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = admin as any

  // 1. Buscar org por dominio (unica por indice) que tenga workspace por defecto.
  const { data: org } = await db
    .from('organizations')
    .select('id, default_workspace_id')
    .eq('email_domain', domain)
    .maybeSingle()

  if (!org?.id || !org.default_workspace_id) return null

  // 2. Resolver el workspace por defecto (necesitamos su slug para redirigir).
  const { data: ws } = await db
    .from('workspaces')
    .select('id, slug')
    .eq('id', org.default_workspace_id)
    .maybeSingle()

  if (!ws?.id || !ws.slug) return null

  // 3. Poblar perfil (solo si aun no tiene org, para no pisar a nadie existente).
  const { data: profile } = await db
    .from('profiles')
    .select('org_id, display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile?.org_id) {
    await db
      .from('profiles')
      .update({
        org_id: org.id,
        org_role: 'member',
        display_name:
          profile?.display_name ??
          (user.user_metadata?.full_name as string | undefined) ??
          email.split('@')[0] ??
          'Usuario',
        avatar_url:
          profile?.avatar_url ??
          (user.user_metadata?.avatar_url as string | undefined) ??
          null,
      })
      .eq('id', user.id)
  }

  // 4. Membresia de org (idempotente).
  await db
    .from('org_members')
    .upsert(
      { org_id: org.id, profile_id: user.id, role: 'member' },
      { onConflict: 'org_id,profile_id', ignoreDuplicates: true }
    )

  // 5. Membresia del workspace por defecto (idempotente).
  await db
    .from('workspace_members')
    .upsert(
      { workspace_id: ws.id, profile_id: user.id, role: 'member' },
      { onConflict: 'workspace_id,profile_id', ignoreDuplicates: true }
    )

  return ws.slug as string
}

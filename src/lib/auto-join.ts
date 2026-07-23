/**
 * Auto-adhesion por dominio de correo (nivel ORGANIZACION, no workspace).
 *
 * Problema historico: un usuario que se registraba SIN invitacion caia en
 * /onboarding y creaba una organizacion nueva, quedando aislado en un workspace
 * propio (paso 2 veces: dos "General" + Alan Ambriz invisible).
 *
 * Modelo actual (SALA DE ESPERA / LOBBY): al registrarse, si el dominio del
 * correo mapea a una organizacion conocida (organizations.email_domain), se une
 * a esa ORG con rol member, pero NO se le da acceso a ningun workspace todavia.
 * Queda en la sala de espera hasta que un administrador lo ubique en un
 * workspace, departamento y equipo. Asi "los miembros no entran a todo" de
 * golpe: el admin decide donde va cada quien.
 *
 * Idempotente: si no hay match de dominio devuelve null. Nunca pisa el org_id de
 * quien ya tiene organizacion.
 */
import type { createAdminClient } from '@/lib/supabase/server'

type Admin = ReturnType<typeof createAdminClient>

interface AutoJoinUser {
  id: string
  email?: string
  user_metadata?: Record<string, unknown>
}

export interface DomainOrgResult {
  orgId: string
  orgName: string
}

/**
 * Une al usuario a la ORGANIZACION de su dominio (sin workspace). Devuelve la
 * org a la que se unio (o a la que ya pertenecia por dominio), o null si el
 * dominio no mapea a ninguna org conocida.
 *
 * NO crea membresia de workspace: eso lo hace el admin desde la sala de espera.
 */
export async function attemptDomainOrgJoin(
  admin: Admin,
  user: AutoJoinUser
): Promise<DomainOrgResult | null> {
  const email = user.email?.trim().toLowerCase()
  if (!email || !email.includes('@')) return null
  const domain = email.split('@')[1]
  if (!domain) return null

  const db = admin

  // 1. Buscar org por dominio (unica por indice).
  const { data: org } = await db
    .from('organizations')
    .select('id, name')
    .eq('email_domain', domain)
    .maybeSingle()

  if (!org?.id) return null

  // 2. Poblar perfil con la org (solo si aun no tiene org, para no pisar a nadie).
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

  // 3. Membresia de org (idempotente). NO se toca workspace_members.
  await db
    .from('org_members')
    .upsert(
      { org_id: org.id, profile_id: user.id, role: 'member' },
      { onConflict: 'org_id,profile_id', ignoreDuplicates: true }
    )

  return { orgId: org.id as string, orgName: (org.name as string) ?? 'tu organización' }
}

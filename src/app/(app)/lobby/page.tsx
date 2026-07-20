/**
 * Sala de espera (LOBBY).
 *
 * Aqui aterriza quien ya pertenece a una organizacion (por dominio de correo o
 * invitacion a la org) pero AUN no tiene acceso a ningun workspace. Espera a que
 * un administrador lo ubique en un workspace, departamento y equipo.
 *
 * Si ya fue ubicado (tiene membresia de algun workspace), se le redirige a el.
 * Si no pertenece a ninguna org, se le manda a onboarding para crear una.
 */
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { LobbyWaiting } from './LobbyWaiting'

export const metadata = { title: 'Sala de espera · WLO' }

export default async function LobbyPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // Si ya lo ubicaron en algun workspace, entrar directo.
  type MemberWs = { workspaces: { slug: string } | null }
  const { data: existing } = (await admin
    .from('workspace_members')
    .select('workspaces ( slug )')
    .eq('profile_id', user.id)
    .limit(1)
    .maybeSingle()) as { data: MemberWs | null; error: unknown }

  if (existing?.workspaces?.slug) {
    redirect(`/w/${existing.workspaces.slug}`)
  }

  // Sin org: no hay sala de espera; ir a crear una organizacion.
  type Prof = { org_id: string | null; display_name: string | null }
  const { data: profile } = (await admin
    .from('profiles')
    .select('org_id, display_name')
    .eq('id', user.id)
    .maybeSingle()) as { data: Prof | null; error: unknown }

  if (!profile?.org_id) {
    redirect('/onboarding')
  }

  const { data: org } = (await admin
    .from('organizations')
    .select('name')
    .eq('id', profile.org_id)
    .maybeSingle()) as { data: { name: string } | null; error: unknown }

  const displayName =
    profile?.display_name ?? user.email?.split('@')[0] ?? 'allá'

  return (
    <LobbyWaiting
      displayName={displayName}
      email={user.email ?? ''}
      orgName={org?.name ?? 'tu organización'}
    />
  )
}

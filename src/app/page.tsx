/**
 * Raíz de la app, redirige al último workspace o al login.
 * Usa admin client para el lookup simple de membership del propio usuario,
 * evitando cualquier edge case de RLS.
 */
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { attemptDomainAutoJoin } from '@/lib/auto-join'

export default async function RootPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Admin client bypass RLS, lookup seguro del propio usuario
  const admin = createAdminClient()

  type MembershipWithWorkspace = { workspace_id: string; workspaces: { slug: string } | null }
  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id, workspaces ( slug )')
    .eq('profile_id', user.id)
    .limit(1)
    .maybeSingle() as { data: MembershipWithWorkspace | null; error: unknown }

  if (membership?.workspaces?.slug) {
    redirect(`/w/${membership.workspaces.slug}`)
  }

  // Sin workspace: antes de mandar a crear una org nueva, intentar auto-unir por
  // dominio de correo (ej. @pavific.com -> org + workspace por defecto). Evita
  // que cada alta sin invitacion cree una org huerfana y aislada.
  const joinedSlug = await attemptDomainAutoJoin(admin, user)
  if (joinedSlug) {
    redirect(`/w/${joinedSlug}`)
  }

  // Sin workspace ni dominio conocido, ir a onboarding
  redirect('/onboarding')
}

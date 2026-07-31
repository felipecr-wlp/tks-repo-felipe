/**
 * Raíz de la app, redirige al último workspace o al login.
 * Usa admin client para el lookup simple de membership del propio usuario,
 * evitando cualquier edge case de RLS.
 */
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { attemptDomainOrgJoin } from '@/lib/auto-join'

export default async function RootPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    redirect('/auth/login')
  }

  // Admin client bypass RLS, lookup seguro del propio usuario
  const admin = createAdminClient()

  // Ordenado por antiguedad de la membresia, no al azar. Con `limit(1)` y sin
  // `order` Postgres puede devolver cualquiera de las filas, asi que a quien
  // pertenecia a mas de un espacio la app lo dejaba caer en uno distinto en
  // cada visita. WLO opera con un solo espacio (General) y este orden lo hace
  // determinista: siempre la membresia mas antigua, que es la de General.
  type MembershipWithWorkspace = { workspace_id: string; workspaces: { slug: string } | null }
  const { data: membership } = await admin
    .from('workspace_members')
    .select('workspace_id, created_at, workspaces ( slug )')
    .eq('profile_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle() as { data: MembershipWithWorkspace | null; error: unknown }

  if (membership?.workspaces?.slug) {
    redirect(`/w/${membership.workspaces.slug}`)
  }

  // Sin workspace: adherir por dominio a la ORGANIZACION conocida (ej.
  // @pavific.com). NO entra a ningun workspace: queda en la sala de espera hasta
  // que un admin lo ubique. Asi los miembros no entran a todo de golpe.
  await attemptDomainOrgJoin(admin, user)

  // Si pertenece a una org (por dominio o por invitacion previa) pero aun no
  // tiene workspace, va a la sala de espera. Solo quien no tiene org va a crear
  // una nueva en onboarding.
  const { data: prof } = await admin
    .from('profiles')
    .select('org_id')
    .eq('id', user.id)
    .maybeSingle() as { data: { org_id: string | null } | null; error: unknown }

  if (prof?.org_id) {
    redirect('/lobby')
  }

  redirect('/onboarding')
}

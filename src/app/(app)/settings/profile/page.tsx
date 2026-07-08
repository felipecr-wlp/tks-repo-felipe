/**
 * /settings/profile — Mi perfil. El usuario edita su nombre para mostrar y
 * elige su avatar de la galería WLO. (Antes este link del UserMenu apuntaba a
 * una página inexistente.)
 */
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ProfileForm } from './ProfileForm'
import { ADMIN_ROLES } from '@/lib/avatars'

export const metadata = { title: 'Mi perfil · WLO' }

export default async function ProfilePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  type ProfileRow = { display_name: string; avatar_url: string | null; org_role: string | null; email: string }
  const { data: profile } = await supabase
    .from('profiles')
    .select('display_name, avatar_url, org_role, email')
    .eq('id', user.id)
    .single() as { data: ProfileRow | null; error: unknown }

  if (!profile) redirect('/onboarding')

  const isAdmin = ADMIN_ROLES.has(profile.org_role ?? '')

  return (
    <div className="min-h-screen bg-background flex items-start justify-center p-6 pt-16">
      <div className="w-full max-w-2xl">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-foreground">Mi perfil</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Cambia tu nombre y elige tu avatar. Se ve en el tablero, el chat y en todo el workspace.
          </p>
        </div>
        <ProfileForm
          initialName={profile.display_name}
          initialAvatar={profile.avatar_url}
          email={profile.email}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  )
}

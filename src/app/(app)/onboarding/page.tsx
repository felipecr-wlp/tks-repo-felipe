/**
 * Onboarding, crea la primera organización y workspace del usuario.
 * Solo se muestra cuando el usuario autenticado no tiene ningún workspace.
 *
 * Usa admin client para el lookup inicial: evita cualquier edge case de RLS
 * (solo consulta datos del propio usuario autenticado).
 */
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { attemptDomainAutoJoin } from '@/lib/auto-join'
import { OnboardingForm } from './OnboardingForm'

export const metadata = { title: 'Configurar espacio de trabajo · WLO' }

export default async function OnboardingPage() {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const admin = createAdminClient()

  // Si ya es miembro de algún workspace, redirigir al dashboard
  type MemberWs = { workspaces: { slug: string } | null }
  const { data: existing } = await admin
    .from('workspace_members')
    .select('workspaces ( slug )')
    .eq('profile_id', user.id)
    .limit(1)
    .maybeSingle() as { data: MemberWs | null; error: unknown }

  if (existing?.workspaces?.slug) {
    redirect(`/w/${existing.workspaces.slug}`)
  }

  // Auto-unir por dominio antes de ofrecer crear una org nueva (misma logica que
  // la raiz): si el correo pertenece a una org conocida, se une a ella.
  const joinedSlug = await attemptDomainAutoJoin(admin, user)
  if (joinedSlug) {
    redirect(`/w/${joinedSlug}`)
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo / Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary text-primary-foreground text-2xl font-bold mb-4">
            T
          </div>
          <h1 className="text-2xl font-semibold text-foreground">Bienvenido a WLO</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Configura tu organización y primer espacio de trabajo
          </p>
        </div>

        <OnboardingForm userEmail={user.email ?? ''} userId={user.id} />
      </div>
    </div>
  )
}

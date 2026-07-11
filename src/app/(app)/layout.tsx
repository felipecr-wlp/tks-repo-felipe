/**
 * Layout protegido de la app.
 * Verifica sesión en el servidor, sin sesión → redirige a login.
 * Provee QueryClient para TanStack Query.
 */
import { redirect } from 'next/navigation'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { QueryProvider } from './QueryProvider'
import { KernAssistant } from '@/components/kern/KernAssistant'
import { WelcomeSplash } from '@/components/WelcomeSplash'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/auth/login')

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle() as { data: { display_name: string | null; avatar_url: string | null } | null; error: unknown }

  const welcomeName = profile?.display_name ?? user.email?.split('@')[0] ?? 'allá'

  return (
    <QueryProvider>
      <WelcomeSplash name={welcomeName} avatarUrl={profile?.avatar_url ?? null} />
      <div className="h-screen flex overflow-hidden bg-background">
        {children}
      </div>
      <KernAssistant />
    </QueryProvider>
  )
}

/**
 * /join/[code], pantalla de unirse a un workspace via invite link.
 * Si el usuario no está logueado, el middleware ya lo redirige a /auth/login.
 */
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { JoinByCodeForm } from './JoinByCodeForm'

interface JoinPageProps {
  params: { code: string }
}

export const metadata = { title: 'Unirme al espacio · WLO' }

export default async function JoinPage({ params }: JoinPageProps) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-primary text-primary-foreground text-xl font-bold mb-3">
            T
          </div>
          <h1 className="text-xl font-semibold text-foreground">Unirme a un espacio</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Estás a punto de unirte con tu cuenta {user.email}
          </p>
        </div>

        <JoinByCodeForm code={params.code} />
      </div>
    </div>
  )
}
